import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { decodeSingleQr, type JsQrDecoderFn } from '../protocol/qrOptical';
import type { DecodeWorkerRequest, DecodeWorkerResponse } from '../workers/qrDecoder.worker';

export interface CameraDeviceInfo {
  deviceId: string;
  label: string;
}

export type DecoderPreference = 'auto' | 'jsqr' | 'native';
export type ActiveDecoderBackend = 'native' | 'jsqr-worker' | 'jsqr-main';

interface UseCameraScannerOptions {
  onQrText: (text: string) => void;
}

interface BarcodeDetectorLike {
  detect(image: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

const mainJsQr: JsQrDecoderFn | undefined =
  typeof jsQR === 'function'
    ? jsQR
    : (jsQR as unknown as { default?: JsQrDecoderFn })?.default;

async function isNativeBarcodeSupported(): Promise<boolean> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!Ctor) return false;
  try {
    if (Ctor.getSupportedFormats) {
      const formats = await Ctor.getSupportedFormats();
      return formats.includes('qr_code');
    }
    return true;
  } catch {
    return false;
  }
}

export function useCameraScanner({ onQrText }: UseCameraScannerOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerBrokenRef = useRef(false);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const busyRef = useRef(false);
  const lastRawRef = useRef('');
  const frameCounterRef = useRef(0);
  const onQrTextRef = useRef(onQrText);
  onQrTextRef.current = onQrText;

  const [isScanning, setIsScanning] = useState(false);
  const [preference, setPreference] = useState<DecoderPreference>('auto');
  const preferenceRef = useRef<DecoderPreference>('auto');
  preferenceRef.current = preference;

  const [backend, setBackend] = useState<ActiveDecoderBackend>('jsqr-worker');
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const [devices, setDevices] = useState<CameraDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [scanFps, setScanFps] = useState(0);
  const [resolution, setResolution] = useState<{ width: number; height: number } | null>(null);
  const [rawQrHits, setRawQrHits] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    busyRef.current = false;
    setIsScanning(false);
    setTorchEnabled(false);
    setTorchSupported(false);
    setScanFps(0);
    setResolution(null);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const cams = all
      .filter((d) => d.kind === 'videoinput')
      .map((d, idx) => ({
        deviceId: d.deviceId,
        label: d.label || `Kamera ${idx + 1}`,
      }));
    setDevices(cams);
  }, []);

  const decodeWithWorkerOrMain = useCallback(
    async (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      attemptBoth: boolean,
    ): Promise<{ text: string | null; usedMain: boolean }> => {
      const imageData = ctx.getImageData(0, 0, width, height);

      if (!workerBrokenRef.current) {
        if (!workerRef.current) {
          try {
            const w = new Worker(
              new URL('../workers/qrDecoder.worker.ts', import.meta.url),
              { type: 'module' },
            );
            w.addEventListener('error', () => {
              workerBrokenRef.current = true;
            });
            workerRef.current = w;
          } catch {
            workerBrokenRef.current = true;
          }
        }

        const w = workerRef.current;
        if (w && !workerBrokenRef.current) {
          const reqId = ++frameCounterRef.current;
          const workerResult = await new Promise<{ text: string | null; failed: boolean }>(
            (resolve) => {
              let settled = false;
              const cleanup = () => {
                w.removeEventListener('message', onMsg);
                w.removeEventListener('error', onErr);
                window.clearTimeout(timer);
              };
              const onMsg = (ev: MessageEvent<DecodeWorkerResponse>) => {
                if (ev.data.id === reqId && !settled) {
                  settled = true;
                  cleanup();
                  resolve({ text: ev.data.text, failed: false });
                }
              };
              const onErr = () => {
                if (!settled) {
                  settled = true;
                  workerBrokenRef.current = true;
                  cleanup();
                  resolve({ text: null, failed: true });
                }
              };
              const timer = window.setTimeout(() => {
                if (!settled) {
                  settled = true;
                  workerBrokenRef.current = true;
                  cleanup();
                  resolve({ text: null, failed: true });
                }
              }, 1200);

              w.addEventListener('message', onMsg);
              w.addEventListener('error', onErr);

              try {
                const msg: DecodeWorkerRequest = {
                  id: reqId,
                  width,
                  height,
                  buffer: imageData.data.buffer,
                  attemptBoth,
                };
                w.postMessage(msg, [imageData.data.buffer]);
              } catch {
                settled = true;
                workerBrokenRef.current = true;
                cleanup();
                resolve({ text: null, failed: true });
              }
            },
          );

          if (!workerResult.failed) {
            return { text: workerResult.text, usedMain: false };
          }
          const fresh = ctx.getImageData(0, 0, width, height);
          if (!mainJsQr) return { text: null, usedMain: true };
          return {
            text: decodeSingleQr(mainJsQr, fresh.data, width, height, attemptBoth),
            usedMain: true,
          };
        }
      }

      if (!mainJsQr) return { text: null, usedMain: true };
      return {
        text: decodeSingleQr(mainJsQr, imageData.data, width, height, attemptBoth),
        usedMain: true,
      };
    },
    [],
  );

  const startCamera = useCallback(
    async (explicitDeviceId?: string) => {
      setError(null);
      stopCamera();

      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          'Akses kamera diblokir browser karena halaman tidak dibuka lewat HTTPS atau localhost.',
        );
        return;
      }

      try {
        const hasNative = await isNativeBarcodeSupported();
        setNativeAvailable(hasNative);
        if (hasNative && !detectorRef.current) {
          const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor })
            .BarcodeDetector!;
          detectorRef.current = new Ctor({ formats: ['qr_code'] });
        }

        const deviceId = explicitDeviceId ?? selectedDeviceId;
        const videoConstraints: MediaTrackConstraints = deviceId
          ? {
              deviceId: { exact: deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            };

        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stopCamera();
          return;
        }

        video.srcObject = stream;
        await video.play();

        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings?.();
        if (settings?.deviceId) {
          setSelectedDeviceId(settings.deviceId);
        }
        const caps = track?.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] })
          | undefined;
        setTorchSupported(Boolean(caps?.torch));

        if (caps?.focusMode?.includes('continuous')) {
          void track
            .applyConstraints({
              advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
            })
            .catch(() => {});
        }

        await refreshDevices();
        setIsScanning(true);

        if (!canvasRef.current) {
          canvasRef.current = document.createElement('canvas');
        }

        let fpsWindowStart = performance.now();
        let fpsFrames = 0;
        let nativeMissStreak = 0;
        let nativeFailed = false;
        let loopTick = 0;
        let lastResW = 0;
        let lastResH = 0;
        let activeBackend: ActiveDecoderBackend | null = null;

        const updateBackend = (next: ActiveDecoderBackend) => {
          if (activeBackend !== next) {
            activeBackend = next;
            setBackend(next);
          }
        };

        const processQr = (text: string | null) => {
          if (!text) return;
          setRawQrHits((c) => c + 1);
          if (text === lastRawRef.current) return;
          lastRawRef.current = text;
          onQrTextRef.current(text);
        };

        const loop = async () => {
          if (!streamRef.current || !videoRef.current) return;
          const v = videoRef.current;

          if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !busyRef.current) {
            busyRef.current = true;
            try {
              const vw = v.videoWidth;
              const vh = v.videoHeight;
              if (vw > 0 && vh > 0) {
                if (vw !== lastResW || vh !== lastResH) {
                  lastResW = vw;
                  lastResH = vh;
                  setResolution({ width: vw, height: vh });
                }

                const maxSide = 760;
                const scale = Math.min(1, maxSide / Math.max(vw, vh));
                const cw = Math.max(1, Math.round(vw * scale));
                const ch = Math.max(1, Math.round(vh * scale));

                const canvas = canvasRef.current!;
                if (canvas.width !== cw || canvas.height !== ch) {
                  canvas.width = cw;
                  canvas.height = ch;
                }

                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  ctx.drawImage(v, 0, 0, cw, ch);
                  loopTick++;

                  const pref = preferenceRef.current;
                  const canTryNative =
                    hasNative &&
                    !nativeFailed &&
                    (pref === 'native' || pref === 'auto');

                  let decoded: string | null = null;

                  const shouldRunNative =
                    canTryNative &&
                    (pref === 'native' || nativeMissStreak < 6 || loopTick % 15 === 0);

                  if (shouldRunNative && detectorRef.current) {
                    updateBackend('native');
                    try {
                      const barcodes = await detectorRef.current.detect(canvas);
                      decoded = barcodes[0]?.rawValue ?? null;
                      if (decoded) {
                        nativeMissStreak = 0;
                      } else {
                        nativeMissStreak++;
                      }
                    } catch {
                      nativeFailed = true;
                    }
                  }

                  if (
                    !decoded &&
                    (pref === 'jsqr' ||
                      (pref === 'auto' &&
                        (!canTryNative || nativeMissStreak >= 2 || loopTick % 3 === 0)))
                  ) {
                    const res = await decodeWithWorkerOrMain(ctx, cw, ch, loopTick % 2 === 0);
                    updateBackend(res.usedMain ? 'jsqr-main' : 'jsqr-worker');
                    decoded = res.text;
                    if (decoded && pref === 'auto') {
                      nativeMissStreak = 10;
                    }
                  }

                  processQr(decoded);

                  fpsFrames++;
                  const now = performance.now();
                  if (now - fpsWindowStart >= 800) {
                    setScanFps(Math.round((fpsFrames * 1000) / (now - fpsWindowStart)));
                    fpsFrames = 0;
                    fpsWindowStart = now;
                  }
                }
              }
            } catch {
              // Keep loop alive across transient frame errors
            } finally {
              busyRef.current = false;
            }
          }

          if (streamRef.current) {
            rafRef.current = requestAnimationFrame(() => {
              void loop();
            });
          }
        };

        rafRef.current = requestAnimationFrame(() => {
          void loop();
        });
      } catch (err) {
        stopCamera();
        const message =
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Izin kamera ditolak. Aktifkan izin kamera pada browser lalu coba lagi.'
            : err instanceof Error
              ? `Gagal membuka kamera: ${err.message}`
              : 'Gagal membuka kamera perangkat.';
        setError(message);
      }
    },
    [decodeWithWorkerOrMain, refreshDevices, selectedDeviceId, stopCamera],
  );

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchEnabled;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchEnabled(next);
    } catch {
      setTorchSupported(false);
    }
  }, [torchEnabled]);

  const resetDedupe = useCallback(() => {
    lastRawRef.current = '';
    setRawQrHits(0);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [stopCamera]);

  return {
    videoRef,
    isScanning,
    backend,
    preference,
    setPreference,
    nativeAvailable,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    torchSupported,
    torchEnabled,
    scanFps,
    resolution,
    rawQrHits,
    error,
    startCamera,
    stopCamera,
    toggleTorch,
    resetDedupe,
  };
}
