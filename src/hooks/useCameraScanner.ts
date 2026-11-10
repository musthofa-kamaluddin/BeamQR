import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  decodeFrameQrs,
  type JsQrDecoderFn,
  type OpticalColorScanMode,
} from '../protocol/qrOptical';
import type { DecodeWorkerRequest, DecodeWorkerResponse } from '../workers/qrDecoder.worker';

export interface CameraDeviceInfo {
  deviceId: string;
  label: string;
}

export type DecoderPreference = 'auto' | 'jsqr' | 'native';
export type ActiveDecoderBackend = 'native' | 'jsqr-worker' | 'jsqr-main';

interface UseCameraScannerOptions {
  onQrTexts: (texts: string[]) => void;
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

export function useCameraScanner({ onQrTexts }: UseCameraScannerOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerBrokenRef = useRef(false);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const busyRef = useRef(false);
  const recentTextsRef = useRef<Set<string>>(new Set());
  const frameCounterRef = useRef(0);
  const onQrTextsRef = useRef(onQrTexts);
  onQrTextsRef.current = onQrTexts;

  const [isScanning, setIsScanning] = useState(false);
  const [preference, setPreference] = useState<DecoderPreference>('auto');
  const preferenceRef = useRef<DecoderPreference>('auto');
  preferenceRef.current = preference;

  const [colorScanMode, setColorScanMode] = useState<OpticalColorScanMode>('auto');
  const colorScanModeRef = useRef<OpticalColorScanMode>('auto');
  colorScanModeRef.current = colorScanMode;

  const [multiScan, setMultiScan] = useState(true);
  const multiScanRef = useRef(true);
  multiScanRef.current = multiScan;

  const [backend, setBackend] = useState<ActiveDecoderBackend>('jsqr-worker');
  const [detectedRgb, setDetectedRgb] = useState(false);
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
    setDetectedRgb(false);
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
      multi: boolean,
      colorMode: OpticalColorScanMode,
    ): Promise<{ texts: string[]; usedRgb: boolean; usedMain: boolean }> => {
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
          const workerResult = await new Promise<{
            texts: string[];
            usedRgb: boolean;
            failed: boolean;
          }>((resolve) => {
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
                resolve({ texts: ev.data.texts, usedRgb: ev.data.usedRgb, failed: false });
              }
            };
            const onErr = () => {
              if (!settled) {
                settled = true;
                workerBrokenRef.current = true;
                cleanup();
                resolve({ texts: [], usedRgb: false, failed: true });
              }
            };
            const timer = window.setTimeout(() => {
              if (!settled) {
                settled = true;
                workerBrokenRef.current = true;
                cleanup();
                resolve({ texts: [], usedRgb: false, failed: true });
              }
            }, 1500);

            w.addEventListener('message', onMsg);
            w.addEventListener('error', onErr);

            try {
              const msg: DecodeWorkerRequest = {
                id: reqId,
                width,
                height,
                buffer: imageData.data.buffer,
                attemptBoth,
                multiScan: multi,
                colorMode,
              };
              w.postMessage(msg, [imageData.data.buffer]);
            } catch {
              settled = true;
              workerBrokenRef.current = true;
              cleanup();
              resolve({ texts: [], usedRgb: false, failed: true });
            }
          });

          if (!workerResult.failed) {
            return { texts: workerResult.texts, usedRgb: workerResult.usedRgb, usedMain: false };
          }
          const fresh = ctx.getImageData(0, 0, width, height);
          if (!mainJsQr) return { texts: [], usedRgb: false, usedMain: true };
          const res = decodeFrameQrs(mainJsQr, fresh.data, width, height, {
            multiScan: multi,
            colorMode,
            attemptBoth,
          });
          return { texts: res.texts, usedRgb: res.usedRgb, usedMain: true };
        }
      }

      if (!mainJsQr) return { texts: [], usedRgb: false, usedMain: true };
      const res = decodeFrameQrs(mainJsQr, imageData.data, width, height, {
        multiScan: multi,
        colorMode,
        attemptBoth,
      });
      return { texts: res.texts, usedRgb: res.usedRgb, usedMain: true };
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
        let lastRgbState = false;

        const updateBackend = (next: ActiveDecoderBackend) => {
          if (activeBackend !== next) {
            activeBackend = next;
            setBackend(next);
          }
        };

        const processQrBatch = (texts: string[]) => {
          if (texts.length === 0) return;
          setRawQrHits((c) => c + texts.length);

          const fresh: string[] = [];
          const recent = recentTextsRef.current;
          if (recent.size > 96) {
            recent.clear();
          }
          for (const t of texts) {
            if (!t || recent.has(t)) continue;
            recent.add(t);
            fresh.push(t);
          }

          if (fresh.length > 0) {
            onQrTextsRef.current(fresh);
          }
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

                // Higher ceiling when multi-QR grid scanning is active so 2x2 quadrants keep sharp modules
                const maxSide = multiScanRef.current ? 960 : 800;
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
                  const cMode = colorScanModeRef.current;
                  const mScan = multiScanRef.current;

                  // Native BarcodeDetector only understands luminance (not RGB-multiplexed channels)
                  const canTryNative =
                    hasNative &&
                    !nativeFailed &&
                    cMode !== 'rgb' &&
                    !lastRgbState &&
                    (pref === 'native' || pref === 'auto');

                  let decodedTexts: string[] = [];

                  const shouldRunNative =
                    canTryNative &&
                    (pref === 'native' || nativeMissStreak < 6 || loopTick % 15 === 0);

                  if (shouldRunNative && detectorRef.current) {
                    updateBackend('native');
                    try {
                      const barcodes = await detectorRef.current.detect(canvas);
                      decodedTexts = barcodes
                        .map((b) => b.rawValue)
                        .filter((val): val is string => Boolean(val));
                      if (decodedTexts.length > 0) {
                        nativeMissStreak = 0;
                      } else {
                        nativeMissStreak++;
                      }
                    } catch {
                      nativeFailed = true;
                    }
                  }

                  if (
                    decodedTexts.length === 0 &&
                    (cMode === 'rgb' ||
                      pref === 'jsqr' ||
                      (pref === 'auto' &&
                        (!canTryNative || nativeMissStreak >= 2 || loopTick % 3 === 0)))
                  ) {
                    const res = await decodeWithWorkerOrMain(
                      ctx,
                      cw,
                      ch,
                      loopTick % 2 === 0,
                      mScan,
                      cMode,
                    );
                    updateBackend(res.usedMain ? 'jsqr-main' : 'jsqr-worker');
                    decodedTexts = res.texts;
                    if (res.usedRgb !== lastRgbState) {
                      lastRgbState = res.usedRgb;
                      setDetectedRgb(res.usedRgb);
                    }
                    if (decodedTexts.length > 0 && pref === 'auto') {
                      nativeMissStreak = 10;
                    }
                  }

                  processQrBatch(decodedTexts);

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
    recentTextsRef.current.clear();
    setRawQrHits(0);
    setDetectedRgb(false);
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
    colorScanMode,
    setColorScanMode,
    multiScan,
    setMultiScan,
    detectedRgb,
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
