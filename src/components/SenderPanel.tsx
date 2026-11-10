import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  FileUp,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Type,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { useWakeLock } from '../hooks/useWakeLock';
import type { TransferMode } from '../protocol/packet';
import { renderQrToCanvas, type ColorMode, type GridLayout } from '../protocol/qrOptical';
import { prepareBroadcast, type PreparedBroadcast } from '../protocol/transferSession';
import { formatBytes, formatDuration } from '../utils/format';

type SourceKind = 'file' | 'text';
type SpeedPreset = 'standard' | 'rgb' | 'quad' | 'turbo';

interface LoadedInput {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

interface SenderPanelProps {
  isActive: boolean;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
}

const PRESETS: Record<
  SpeedPreset,
  { label: string; badge: string; grid: GridLayout; color: ColorMode; block: number; fps: number }
> = {
  standard: { label: '1x Standar', badge: '1 QR', grid: '1x1', color: 'mono', block: 140, fps: 8 },
  rgb: { label: '3x RGB', badge: '3 CH', grid: '1x1', color: 'rgb', block: 120, fps: 7 },
  quad: { label: '4x Quad', badge: '2x2', grid: '2x2', color: 'mono', block: 100, fps: 7 },
  turbo: { label: '12x Turbo', badge: '2x2 RGB', grid: '2x2', color: 'rgb', block: 100, fps: 6 },
};

export function SenderPanel({ isActive, headingRef }: SenderPanelProps) {
  const [sourceKind, setSourceKind] = useState<SourceKind>('file');
  const [textDraft, setTextDraft] = useState('');
  const [textFileName, setTextFileName] = useState('catatan.txt');
  const [loadedInput, setLoadedInput] = useState<LoadedInput | null>(null);
  const [dragging, setDragging] = useState(false);

  const [mode, setMode] = useState<TransferMode>('lt');
  const [gridLayout, setGridLayout] = useState<GridLayout>('1x1');
  const [colorMode, setColorMode] = useState<ColorMode>('mono');
  const [fps, setFps] = useState(8);
  const [blockSize, setBlockSize] = useState(140);
  const [eccLevel, setEccLevel] = useState<'L' | 'M'>('L');
  const [enableCompression, setEnableCompression] = useState(true);

  const [broadcast, setBroadcast] = useState<PreparedBroadcast | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);

  const [frameStats, setFrameStats] = useState({
    frameNumber: 0,
    hasManifest: true,
    firstSeq: -1,
    packetCount: 1,
    actualFps: 0,
  });

  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([null, null, null, null]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameIndexRef = useRef(0);

  const fpsId = useId();
  const blockSizeId = useId();
  const modeId = useId();
  const gridId = useId();
  const colorId = useId();
  const eccId = useId();
  const compressId = useId();
  const textAreaId = useId();
  const textNameId = useId();

  useWakeLock(isActive && isPlaying);

  const gridCells = gridLayout === '2x2' ? 4 : gridLayout === '2x1' ? 2 : 1;
  const channelsPerCell = colorMode === 'rgb' ? 3 : 1;
  const packetsPerFrame = gridCells * channelsPerCell;

  const activePreset: SpeedPreset | null = useMemo(() => {
    for (const key of Object.keys(PRESETS) as SpeedPreset[]) {
      const p = PRESETS[key];
      if (
        p.grid === gridLayout &&
        p.color === colorMode &&
        p.block === blockSize &&
        p.fps === fps
      ) {
        return key;
      }
    }
    return null;
  }, [gridLayout, colorMode, blockSize, fps]);

  const applyPreset = (key: SpeedPreset) => {
    const p = PRESETS[key];
    setGridLayout(p.grid);
    setColorMode(p.color);
    setBlockSize(p.block);
    setFps(p.fps);
  };

  const activeInput: LoadedInput | null = useMemo(() => {
    if (sourceKind === 'file') return loadedInput;
    if (!textDraft.trim()) return null;
    return {
      bytes: new TextEncoder().encode(textDraft),
      fileName: textFileName.trim() || 'catatan.txt',
      mimeType: 'text/plain;charset=utf-8',
    };
  }, [sourceKind, loadedInput, textDraft, textFileName]);

  const handleFilePicked = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setPrepError(null);
    const buffer = await file.arrayBuffer();
    setLoadedInput({
      bytes: new Uint8Array(buffer),
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
    });
  }, []);

  // Re-prepare broadcast whenever input or encoding parameters change; waits for Start click
  useEffect(() => {
    let cancelled = false;

    if (!activeInput) {
      setBroadcast(null);
      setIsPlaying(false);
      setHasStarted(false);
      return;
    }

    setIsPlaying(false);
    setHasStarted(false);
    setPreparing(true);
    setPrepError(null);

    void prepareBroadcast({
      bytes: activeInput.bytes,
      fileName: activeInput.fileName,
      mimeType: activeInput.mimeType,
      blockSize,
      mode,
      enableCompression,
    })
      .then((prepared) => {
        if (cancelled) return;
        frameIndexRef.current = 0;
        setBroadcast(prepared);
      })
      .catch((err) => {
        if (cancelled) return;
        setPrepError(err instanceof Error ? err.message : 'Gagal menyiapkan paket QR.');
        setBroadcast(null);
        setIsPlaying(false);
        setHasStarted(false);
      })
      .finally(() => {
        if (!cancelled) setPreparing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeInput, blockSize, mode, enableCompression]);

  // Render QR frame loop (paused automatically when tab is hidden or before Start)
  useEffect(() => {
    if (!broadcast) return;

    let cancelled = false;
    let timerId: number | null = null;
    let fpsWindowStart = performance.now();
    let framesInWindow = 0;
    let lastMeasuredFps = 0;

    const drawSingleTick = (idx: number) => {
      const batch = broadcast.generateBatchQr(idx, packetsPerFrame);
      const cellSizePx = gridCells === 1 ? 460 : 280;

      for (let cell = 0; cell < gridCells; cell++) {
        const canvas = canvasRefs.current[cell];
        if (!canvas) continue;
        const start = cell * channelsPerCell;
        const texts = batch
          .slice(start, start + channelsPerCell)
          .map((slot) => slot.qrText);
        renderQrToCanvas(canvas, texts, colorMode, eccLevel, cellSizePx);
      }

      if (cancelled) return;
      framesInWindow++;
      const now = performance.now();
      const elapsed = now - fpsWindowStart;
      if (elapsed >= 900) {
        lastMeasuredFps = Math.round((framesInWindow * 1000) / elapsed);
        framesInWindow = 0;
        fpsWindowStart = now;
      }

      setFrameStats({
        frameNumber: idx + 1,
        hasManifest: batch.some((b) => b.isManifest),
        firstSeq: batch.find((b) => !b.isManifest)?.seqOrIndex ?? -1,
        packetCount: batch.length,
        actualFps: lastMeasuredFps,
      });
    };

    if (!isPlaying || !isActive) {
      drawSingleTick(frameIndexRef.current);
      return () => {
        cancelled = true;
      };
    }

    const intervalMs = Math.max(35, Math.round(1000 / fps));
    const tick = () => {
      if (cancelled) return;
      const start = performance.now();
      const currentIdx = frameIndexRef.current++;
      drawSingleTick(currentIdx);
      if (cancelled) return;
      const spent = performance.now() - start;
      const delay = Math.max(4, intervalMs - spent);
      timerId = window.setTimeout(tick, delay);
    };

    tick();

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [broadcast, isPlaying, isActive, fps, eccLevel, gridCells, channelsPerCell, packetsPerFrame, colorMode]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else if (el.requestFullscreen) {
      await el.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleTogglePlay = useCallback(() => {
    if (!broadcast) return;
    if (!hasStarted) {
      frameIndexRef.current = 0;
      setHasStarted(true);
      setIsPlaying(true);
      return;
    }
    setIsPlaying((p) => !p);
  }, [broadcast, hasStarted]);

  const restartSweep = useCallback(() => {
    if (!broadcast) return;
    frameIndexRef.current = 0;
    setHasStarted(true);
    setIsPlaying(true);
  }, [broadcast]);

  const estThroughputKbs = ((blockSize * packetsPerFrame * fps) / 1024).toFixed(1);
  const estimatedSweepSec = broadcast
    ? Math.max(0.5, (broadcast.manifest.k * 1.15) / (fps * packetsPerFrame))
    : 0;

  return (
    <div className="page-enter stack" style={{ gap: 16 }}>
      <div className="page-banner">
        <div className="stack" style={{ gap: 6 }}>
          <span className="pixel-badge" data-tone="mint">
            ROUTE // /SEND | TRANSMITTER
          </span>
          <h1 ref={headingRef} tabIndex={-1} className="page-title">
            Pemancar QR Optik
          </h1>
          <p className="card-meta" style={{ maxWidth: '62ch' }}>
            Pilih file atau ketik catatan, pilih preset kecepatan optik (Mono / Multi-QR Grid /
            RGB Color 3x), lalu tekan <strong>Start</strong>.
          </p>
        </div>
        {broadcast && (
          <span className="status-pill" data-tone={isPlaying ? 'accent' : 'amber'}>
            <span className="status-dot" aria-hidden="true" />
            {isPlaying ? 'Memancarkan' : hasStarted ? 'Dijeda' : 'Siap (Klik Start)'}
          </span>
        )}
      </div>

      <div className="bento-grid sender-bento" data-has-broadcast={broadcast ? 'true' : 'false'}>
        {/* Left Hero Column: Optical QR Stage */}
        <section className="pixel-card stack sender-stage-card" aria-label="Proyeksi QR Code">
          <div className="card-header" style={{ marginBlockEnd: 2 }}>
            <div>
              <h2 className="card-title">Layar Proyeksi Optik</h2>
              <p className="card-meta">
                {packetsPerFrame > 1
                  ? `Mode paralel ${packetsPerFrame}x paket per frame (${gridLayout.toUpperCase()} ${colorMode.toUpperCase()})`
                  : 'Mode standar 1x QR monokrom'}
              </p>
            </div>
            <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--fg-secondary)' }}>
              {mode === 'lt' ? 'LT-FOUNTAIN' : 'CYCLIC'} | ~{estThroughputKbs} KB/s
            </span>
          </div>

          <div
            ref={stageRef}
            className={`qr-stage ${isFullscreen ? 'qr-stage-fullscreen' : ''}`}
            data-qr-stage="true"
          >
            {broadcast ? (
              <div className="qr-multi-grid" data-layout={gridLayout}>
                {Array.from({ length: gridCells }).map((_, idx) => (
                  <div key={idx} className="qr-cell-box">
                    <canvas
                      ref={(el) => {
                        canvasRefs.current[idx] = el;
                      }}
                      aria-label={`Slot QR ${idx + 1} untuk transfer optik`}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="qr-canvas-frame">
                <div style={{ textAlign: 'center', padding: 20, color: '#52525b' }}>
                  <p style={{ fontWeight: 600, color: '#18181b', marginBottom: 4 }}>
                    {preparing ? 'Menyiapkan blok data...' : 'Belum ada file dipilih'}
                  </p>
                  <p style={{ fontSize: '0.8125rem' }}>
                    Pilih file atau masukkan teks di panel pengaturan untuk mulai memancarkan QR.
                  </p>
                </div>
              </div>
            )}

            {broadcast && (
              <div className="qr-stage-caption mono">
                <span>
                  {!hasStarted
                    ? `SIAP | FRAME #1 (${packetsPerFrame} PKT/FRAME)`
                    : `FRAME #${frameStats.frameNumber} | ${
                        frameStats.hasManifest ? 'MANIFEST+' : ''
                      }${frameStats.packetCount} PKT (SEQ #${Math.max(0, frameStats.firstSeq)})`}
                </span>
                <span>
                  {isPlaying ? `${frameStats.actualFps || fps} FPS` : `Target ${fps} FPS`} |{' '}
                  {broadcast.manifest.k} BLOK
                </span>
              </div>
            )}
          </div>

          <div className="action-bar">
            <button
              type="button"
              className="btn btn-primary action-main"
              disabled={!broadcast}
              onClick={handleTogglePlay}
            >
              {isPlaying ? (
                <Pause size={16} aria-hidden="true" />
              ) : (
                <Play size={16} aria-hidden="true" />
              )}
              {isPlaying ? 'Jeda' : hasStarted ? 'Lanjutkan' : 'Start'}
            </button>

            <button
              type="button"
              className="btn"
              disabled={!broadcast || !hasStarted}
              onClick={restartSweep}
            >
              <RotateCcw size={16} aria-hidden="true" />
              Ulang
            </button>

            {typeof document !== 'undefined' && document.fullscreenEnabled && (
              <button
                type="button"
                className="btn"
                disabled={!broadcast}
                onClick={() => void toggleFullscreen()}
              >
                {isFullscreen ? (
                  <Minimize2 size={16} aria-hidden="true" />
                ) : (
                  <Maximize2 size={16} aria-hidden="true" />
                )}
                {isFullscreen ? 'Keluar Fullscreen' : 'Layar Penuh'}
              </button>
            )}
          </div>

          {broadcast && (
            <div className="stats-grid stats-grid-4">
              <div className="stat-cell">
                <span className="stat-label">Ukuran Asli</span>
                <span className="stat-value metric">{formatBytes(broadcast.manifest.origSize)}</span>
              </div>
              <div className="stat-cell">
                <span className="stat-label">Payload</span>
                <span className="stat-value metric">
                  {formatBytes(broadcast.manifest.compSize)}
                  {broadcast.manifest.compressed ? ' (gz)' : ''}
                </span>
              </div>
              <div className="stat-cell">
                <span className="stat-label">Total Blok (K)</span>
                <span className="stat-value metric">{broadcast.manifest.k}</span>
              </div>
              <div className="stat-cell">
                <span className="stat-label">Est. Sapuan</span>
                <span className="stat-value metric">~{formatDuration(estimatedSweepSec)}</span>
              </div>
            </div>
          )}
        </section>

        {/* Right Control Column: Source & Optical Speed Tuning */}
        <aside
          className="pixel-card stack sender-controls-card"
          aria-label="Sumber data dan pengaturan"
        >
          <div className="card-header" style={{ marginBlockEnd: 0 }}>
            <h3 className="card-title">Sumber &amp; Kecepatan</h3>
            <div className="source-tabs" role="group" aria-label="Jenis input">
              <button
                type="button"
                className="source-btn"
                aria-pressed={sourceKind === 'file'}
                onClick={() => setSourceKind('file')}
              >
                <FileUp
                  size={13}
                  aria-hidden="true"
                  style={{ marginRight: 5, verticalAlign: '-2px' }}
                />
                File
              </button>
              <button
                type="button"
                className="source-btn"
                aria-pressed={sourceKind === 'text'}
                onClick={() => setSourceKind('text')}
              >
                <Type
                  size={13}
                  aria-hidden="true"
                  style={{ marginRight: 5, verticalAlign: '-2px' }}
                />
                Teks
              </button>
            </div>
          </div>

          {sourceKind === 'file' ? (
            <label
              className="dropzone"
              data-dragging={dragging ? 'true' : 'false'}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void handleFilePicked(e.dataTransfer.files?.[0]);
              }}
            >
              <input
                type="file"
                aria-label="Pilih file untuk ditransfer lewat QR Code"
                onChange={(e) => {
                  void handleFilePicked(e.target.files?.[0]);
                }}
              />
              <FileUp size={22} aria-hidden="true" style={{ color: 'var(--accent)' }} />
              <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                {loadedInput ? loadedInput.fileName : 'Pilih atau seret file ke sini'}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--fg-secondary)' }}>
                {loadedInput
                  ? `${formatBytes(loadedInput.bytes.length)} | Klik untuk ganti`
                  : 'Pakai preset Quad/RGB untuk kirim file lebih cepat'}
              </span>
            </label>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <div className="control-field">
                <label htmlFor={textNameId} className="control-label">
                  Nama File Output
                </label>
                <input
                  id={textNameId}
                  type="text"
                  className="select-input mono"
                  value={textFileName}
                  onChange={(e) => setTextFileName(e.target.value)}
                />
              </div>
              <div className="control-field">
                <label htmlFor={textAreaId} className="control-label">
                  Konten Teks
                </label>
                <textarea
                  id={textAreaId}
                  className="textarea-input"
                  placeholder="Ketik atau tempel teks, kunci konfigurasi, atau JSON di sini..."
                  value={textDraft}
                  onChange={(e) => setTextDraft(e.target.value)}
                />
              </div>
            </div>
          )}

          {activeInput && activeInput.bytes.length > 500 * 1024 && (
            <div className="notice" data-tone="warn" role="status">
              <AlertTriangle size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                File berukuran <strong>{formatBytes(activeInput.bytes.length)}</strong>. Gunakan
                preset <strong>4x Quad</strong> atau <strong>12x Turbo</strong> untuk mempercepat
                transfer.
              </span>
            </div>
          )}

          {prepError && (
            <div className="notice" data-tone="danger" role="alert">
              <span>{prepError}</span>
            </div>
          )}

          {/* Optical Speed Presets */}
          <div className="control-field">
            <span className="control-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Zap size={13} aria-hidden="true" style={{ color: 'var(--amber)' }} />
              Preset Kecepatan Optik
            </span>
            <div className="preset-grid">
              {(Object.keys(PRESETS) as SpeedPreset[]).map((key) => {
                const p = PRESETS[key];
                const selected = activePreset === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className="preset-chip"
                    aria-pressed={selected}
                    onClick={() => applyPreset(key)}
                  >
                    <strong>{p.label}</strong>
                    <span className="mono">{p.badge}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="stats-grid">
            <div className="control-field">
              <label htmlFor={gridId} className="control-label">
                Grid QR
              </label>
              <select
                id={gridId}
                className="select-input"
                value={gridLayout}
                onChange={(e) => setGridLayout(e.target.value as GridLayout)}
              >
                <option value="1x1">1x1 (Tunggal)</option>
                <option value="2x1">2x1 (2 QR, 2x)</option>
                <option value="2x2">2x2 (4 QR, 4x)</option>
              </select>
            </div>

            <div className="control-field">
              <label htmlFor={colorId} className="control-label">
                Spektrum Warna
              </label>
              <select
                id={colorId}
                className="select-input"
                value={colorMode}
                onChange={(e) => setColorMode(e.target.value as ColorMode)}
              >
                <option value="mono">Monokrom (1x)</option>
                <option value="rgb">RGB Color (3x)</option>
              </select>
            </div>
          </div>

          <div className="control-field">
            <div className="control-label-row">
              <label htmlFor={fpsId} className="control-label">
                Kecepatan Pancar (FPS)
              </label>
              <span className="control-value metric">{fps} FPS</span>
            </div>
            <input
              id={fpsId}
              type="range"
              min={2}
              max={20}
              step={1}
              value={fps}
              aria-valuetext={`${fps} frame per detik`}
              className="telemetry-slider"
              style={
                {
                  '--attr-min': 2,
                  '--attr-max': 20,
                  '--control-value': fps,
                } as React.CSSProperties
              }
              onChange={(e) => setFps(Number(e.target.value))}
            />
          </div>

          <div className="control-field">
            <div className="control-label-row">
              <label htmlFor={blockSizeId} className="control-label">
                Ukuran Blok / Channel
              </label>
              <span className="control-value metric">{blockSize} B</span>
            </div>
            <input
              id={blockSizeId}
              type="range"
              min={80}
              max={360}
              step={20}
              value={blockSize}
              aria-valuetext={`${blockSize} byte per paket`}
              className="telemetry-slider"
              style={
                {
                  '--attr-min': 80,
                  '--attr-max': 360,
                  '--control-value': blockSize,
                } as React.CSSProperties
              }
              onChange={(e) => setBlockSize(Number(e.target.value))}
            />
          </div>

          <div className="stats-grid">
            <div className="control-field">
              <label htmlFor={modeId} className="control-label">
                Protokol
              </label>
              <select
                id={modeId}
                className="select-input"
                value={mode}
                onChange={(e) => setMode(e.target.value as TransferMode)}
              >
                <option value="lt">Fountain LT</option>
                <option value="cyclic">Cyclic Loop</option>
              </select>
            </div>

            <div className="control-field">
              <label htmlFor={eccId} className="control-label">
                QR ECC
              </label>
              <select
                id={eccId}
                className="select-input"
                value={eccLevel}
                onChange={(e) => setEccLevel(e.target.value as 'L' | 'M')}
              >
                <option value="L">Level L (7%)</option>
                <option value="M">Level M (15%)</option>
              </select>
            </div>
          </div>

          <label
            htmlFor={compressId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            <input
              id={compressId}
              type="checkbox"
              checked={enableCompression}
              onChange={(e) => setEnableCompression(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            Kompresi Deflate-Raw sebelum transfer
          </label>
        </aside>
      </div>
    </div>
  );
}
