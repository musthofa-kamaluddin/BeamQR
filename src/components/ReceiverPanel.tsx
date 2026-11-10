import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Download,
  Flashlight,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { useCameraScanner } from '../hooks/useCameraScanner';
import { useWakeLock } from '../hooks/useWakeLock';
import type { OpticalColorScanMode } from '../protocol/qrOptical';
import { ReceiveSession, type ReceiveSnapshot } from '../protocol/transferSession';
import { formatBytes, isImagePreviewable, isTextPreviewable } from '../utils/format';
import { BlockMatrix } from './BlockMatrix';

interface ReceiverPanelProps {
  isActive: boolean;
  themeKey: string;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
}

export function ReceiverPanel({ isActive, themeKey, headingRef }: ReceiverPanelProps) {
  const sessionRef = useRef<ReceiveSession>(new ReceiveSession());
  const [snapshot, setSnapshot] = useState<ReceiveSnapshot>(() => sessionRef.current.getSnapshot());
  const [throughputBps, setThroughputBps] = useState(0);
  const transferStartRef = useRef<number | null>(null);

  const cameraSelectId = useId();
  const decoderSelectId = useId();
  const colorScanId = useId();
  const multiScanId = useId();
  const progressId = useId();

  const handleQrTexts = useCallback((texts: string[]) => {
    void sessionRef.current.ingestBatch(texts).then(({ changed, snapshot: next }) => {
      if (!changed) return;
      if (next.status === 'receiving' && transferStartRef.current === null) {
        transferStartRef.current = performance.now();
      }
      if (next.manifest && transferStartRef.current !== null) {
        const elapsedSec = Math.max(0.2, (performance.now() - transferStartRef.current) / 1000);
        const bytesReceived = Math.min(
          next.manifest.compSize,
          next.solvedBlocks * next.manifest.blockSize,
        );
        setThroughputBps(Math.round(bytesReceived / elapsedSec));
      }
      setSnapshot(next);
    });
  }, []);

  const scanner = useCameraScanner({ onQrTexts: handleQrTexts });
  const { stopCamera, isScanning } = scanner;
  useWakeLock(isActive && isScanning);

  useEffect(() => {
    if ((!isActive || snapshot.status === 'completed') && isScanning) {
      stopCamera();
    }
  }, [isActive, snapshot.status, isScanning, stopCamera]);

  const handleReset = useCallback(() => {
    sessionRef.current.reset();
    scanner.resetDedupe();
    transferStartRef.current = null;
    setThroughputBps(0);
    setSnapshot(sessionRef.current.getSnapshot());
  }, [scanner]);

  const downloadUrl = useMemo(() => {
    if (!snapshot.recoveredBytes || !snapshot.manifest) return null;
    const blob = new Blob([new Uint8Array(snapshot.recoveredBytes)], {
      type: snapshot.manifest.mimeType || 'application/octet-stream',
    });
    return URL.createObjectURL(blob);
  }, [snapshot.recoveredBytes, snapshot.manifest]);

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  const textPreview = useMemo(() => {
    if (!snapshot.recoveredBytes || !snapshot.manifest) return null;
    if (!isTextPreviewable(snapshot.manifest.mimeType, snapshot.manifest.fileName)) return null;
    const slice = snapshot.recoveredBytes.subarray(0, 16384);
    return new TextDecoder().decode(slice);
  }, [snapshot.recoveredBytes, snapshot.manifest]);

  const imagePreviewUrl = useMemo(() => {
    if (!downloadUrl || !snapshot.manifest) return null;
    return isImagePreviewable(snapshot.manifest.mimeType, snapshot.manifest.fileName)
      ? downloadUrl
      : null;
  }, [downloadUrl, snapshot.manifest]);

  const progressPct =
    snapshot.totalBlocks > 0
      ? Math.min(100, Math.round((snapshot.solvedBlocks / snapshot.totalBlocks) * 100))
      : 0;

  const statusMeta = (() => {
    switch (snapshot.status) {
      case 'completed':
        return { label: 'Selesai & Terverifikasi', tone: 'accent' as const };
      case 'verifying':
        return { label: 'Memverifikasi SHA-256...', tone: 'warn' as const };
      case 'checksum_error':
        return { label: 'Verifikasi Gagal', tone: 'warn' as const };
      case 'receiving':
        return { label: `Menerima (${progressPct}%)`, tone: 'accent' as const };
      default:
        return {
          label: scanner.isScanning ? 'Memindai QR...' : 'Kamera Siaga',
          tone: undefined,
        };
    }
  })();

  return (
    <div className="page-enter stack" style={{ gap: 16 }}>
      <div className="page-banner">
        <div className="stack" style={{ gap: 6 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span className="pixel-badge" data-tone="sky">
              ROUTE // /RECEIVE | OPTICAL SCANNER
            </span>
            {scanner.detectedRgb && (
              <span className="pixel-badge" data-tone="amber">
                RGB 3-CHANNEL TERDETEKSI
              </span>
            )}
          </div>
          <h1 ref={headingRef} tabIndex={-1} className="page-title">
            Pemindai Kamera QR
          </h1>
          <p className="card-meta" style={{ maxWidth: '62ch' }}>
            Mendukung pemindaian tunggal, <strong>Multi-QR Grid (2x1 / 2x2)</strong>, dan{' '}
            <strong>RGB Color (3x)</strong> secara otomatis dalam satu frame kamera.
          </p>
        </div>
        <span className="status-pill" data-tone={statusMeta.tone}>
          <span className="status-dot" aria-hidden="true" />
          {statusMeta.label}
        </span>
      </div>

      <div className="bento-grid">
        {/* Left Column: Live Camera Viewfinder */}
        <section className="pixel-card stack" aria-label="Pemindai kamera QR">
          <div className="card-header" style={{ marginBlockEnd: 2 }}>
            <div>
              <h2 className="card-title">Jendela Kamera</h2>
              <p className="card-meta">
                Posisikan seluruh kotak (atau grid 2x2) di dalam bingkai kamera.
              </p>
            </div>
            <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--fg-secondary)' }}>
              {scanner.isScanning ? `${scanner.scanFps} FPS` : 'STANDBY'}
            </span>
          </div>

          <div className="viewfinder" data-scanning={scanner.isScanning ? 'true' : 'false'}>
            <video ref={scanner.videoRef} autoPlay playsInline muted />
            <div
              className="reticle"
              data-locked={snapshot.status === 'receiving' || scanner.rawQrHits > 0 ? 'true' : 'false'}
              aria-hidden="true"
            />
            {scanner.isScanning && <div className="scan-laser" aria-hidden="true" />}
            {!scanner.isScanning && (
              <div className="viewfinder-placeholder">
                <div>
                  <Camera size={32} aria-hidden="true" style={{ marginBottom: 8, opacity: 0.85 }} />
                  <p style={{ fontWeight: 600, marginBottom: 4 }}>
                    {snapshot.status === 'completed'
                      ? 'Transfer selesai, kamera dimatikan otomatis'
                      : 'Kamera belum aktif'}
                  </p>
                  <p style={{ fontSize: '0.8125rem', color: '#a1a1aa' }}>
                    Tekan tombol Mulai Kamera untuk memindai aliran QR dari layar pengirim.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="action-bar">
            {!scanner.isScanning ? (
              <button
                type="button"
                className="btn btn-primary action-main"
                onClick={() => void scanner.startCamera()}
              >
                <Camera size={16} aria-hidden="true" />
                Mulai Kamera
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-danger action-main"
                onClick={scanner.stopCamera}
              >
                <CameraOff size={16} aria-hidden="true" />
                Matikan Kamera
              </button>
            )}

            {scanner.torchSupported && scanner.isScanning && (
              <button
                type="button"
                className="btn"
                aria-pressed={scanner.torchEnabled}
                onClick={() => void scanner.toggleTorch()}
              >
                <Flashlight size={16} aria-hidden="true" />
                {scanner.torchEnabled ? 'Senter Hidup' : 'Senter'}
              </button>
            )}

            <button type="button" className="btn" onClick={handleReset}>
              <RotateCcw size={16} aria-hidden="true" />
              Reset Sesi
            </button>

            {scanner.devices.length > 1 && (
              <div className="camera-picker-wrap">
                <label htmlFor={cameraSelectId} className="visually-hidden">
                  Pilih Kamera
                </label>
                <select
                  id={cameraSelectId}
                  className="select-input"
                  value={scanner.selectedDeviceId}
                  onChange={(e) => {
                    const id = e.target.value;
                    scanner.setSelectedDeviceId(id);
                    if (scanner.isScanning) {
                      void scanner.startCamera(id);
                    }
                  }}
                >
                  {scanner.devices.map((dev) => (
                    <option key={dev.deviceId} value={dev.deviceId}>
                      {dev.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {scanner.error && (
            <div className="notice" data-tone="danger" role="alert">
              <span>{scanner.error}</span>
            </div>
          )}

          <div className="visually-hidden" role="status" aria-live="polite">
            {snapshot.status === 'completed' && snapshot.manifest
              ? `Transfer selesai. File ${snapshot.manifest.fileName} terverifikasi SHA-256 dan siap diunduh.`
              : snapshot.status === 'checksum_error'
                ? snapshot.errorMessage
                : ''}
          </div>
        </section>

        {/* Right Column: Telemetry, Block Matrix & Output */}
        <aside className="pixel-card stack" aria-label="Status penerimaan dan hasil">
          <div className="card-header" style={{ marginBlockEnd: 0 }}>
            <h3 className="card-title">Telemetri &amp; Rekonstruksi</h3>
            <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--fg-secondary)' }}>
              {scanner.backend === 'native'
                ? 'Native Barcode'
                : scanner.backend === 'jsqr-main'
                  ? 'jsQR Main'
                  : 'jsQR Worker'}
              {scanner.resolution ? ` | ${scanner.resolution.width}x${scanner.resolution.height}` : ''}
            </span>
          </div>

          <div className="stats-grid">
            <div className="control-field">
              <label htmlFor={decoderSelectId} className="control-label">
                Decoder QR
              </label>
              <select
                id={decoderSelectId}
                className="select-input"
                value={scanner.preference}
                onChange={(e) => scanner.setPreference(e.target.value as typeof scanner.preference)}
              >
                <option value="auto">Auto (Hybrid)</option>
                <option value="jsqr">jsQR Worker</option>
                {scanner.nativeAvailable && <option value="native">Native API</option>}
              </select>
            </div>

            <div className="control-field">
              <label htmlFor={colorScanId} className="control-label">
                Deteksi Warna
              </label>
              <select
                id={colorScanId}
                className="select-input"
                value={scanner.colorScanMode}
                onChange={(e) =>
                  scanner.setColorScanMode(e.target.value as OpticalColorScanMode)
                }
              >
                <option value="auto">Auto (Mono + RGB)</option>
                <option value="rgb">Paksa Split RGB (3x)</option>
                <option value="mono">Mono Saja</option>
              </select>
            </div>
          </div>

          <label
            htmlFor={multiScanId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            <input
              id={multiScanId}
              type="checkbox"
              checked={scanner.multiScan}
              onChange={(e) => scanner.setMultiScan(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            Scan Multi-QR per frame (Grid 2x1 / 2x2)
          </label>

          {snapshot.manifest ? (
            <div className="stack" style={{ gap: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <strong style={{ wordBreak: 'break-word' }}>{snapshot.manifest.fileName}</strong>
                <span className="mono" style={{ fontSize: '0.8125rem', color: 'var(--fg-secondary)' }}>
                  {formatBytes(snapshot.manifest.origSize)}
                </span>
              </div>

              <div className="control-field">
                <div className="control-label-row">
                  <label htmlFor={progressId} className="control-label">
                    Progres Rekonstruksi
                  </label>
                  <span className="control-value metric">
                    {snapshot.solvedBlocks}/{snapshot.totalBlocks} ({progressPct}%)
                  </span>
                </div>
                <progress
                  id={progressId}
                  className="telemetry-progress"
                  value={snapshot.solvedBlocks}
                  max={Math.max(1, snapshot.totalBlocks)}
                />
              </div>

              <BlockMatrix
                states={snapshot.blockStates}
                totalBlocks={snapshot.totalBlocks}
                solvedBlocks={snapshot.solvedBlocks}
                themeKey={themeKey}
              />
            </div>
          ) : (
            <div className="notice">
              <span>
                {snapshot.bufferedPreManifest > 0
                  ? `${snapshot.bufferedPreManifest} paket data tertangkap; menunggu frame Manifest dari pengirim...`
                  : snapshot.invalidScans > 0
                    ? `Terbaca ${snapshot.invalidScans} QR non-BeamQR atau frame korup - pastikan kamera fokus ke seluruh kotak QR.`
                    : 'Menunggu frame Manifest atau Data QR pertama dari pengirim.'}
              </span>
            </div>
          )}

          <div className="stats-grid">
            <div className="stat-cell">
              <span className="stat-label">Paket Unik</span>
              <span className="stat-value metric">{snapshot.uniquePackets}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">Persamaan XOR</span>
              <span className="stat-value metric">{snapshot.activeEquations}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">Kecepatan Efektif</span>
              <span className="stat-value metric">
                {throughputBps > 0 ? `${(throughputBps / 1024).toFixed(1)} KB/s` : '-'}
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">Hit QR / Kamera</span>
              <span className="stat-value metric">
                {scanner.isScanning ? `${scanner.rawQrHits} | ${scanner.scanFps} FPS` : '-'}
              </span>
            </div>
          </div>

          {snapshot.status === 'checksum_error' && (
            <div className="notice" data-tone="danger" role="alert">
              <ShieldAlert size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{snapshot.errorMessage || 'Verifikasi checksum SHA-256 gagal.'}</span>
            </div>
          )}

          {snapshot.status === 'completed' && snapshot.manifest && downloadUrl && (
            <div className="stack" style={{ gap: 12 }}>
              <div className="notice" data-tone="accent">
                <CheckCircle2 size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <strong>Terverifikasi SHA-256</strong>
                  <span
                    className="mono"
                    style={{ fontSize: '0.7rem', wordBreak: 'break-all', opacity: 0.9 }}
                  >
                    {snapshot.verifiedSha256Hex}
                  </span>
                </div>
              </div>

              <a
                href={downloadUrl}
                download={snapshot.manifest.fileName}
                className="btn btn-primary"
                style={{ textDecoration: 'none' }}
              >
                <Download size={16} aria-hidden="true" />
                Unduh {snapshot.manifest.fileName}
              </a>

              {imagePreviewUrl && (
                <img
                  src={imagePreviewUrl}
                  alt={`Pratinjau ${snapshot.manifest.fileName}`}
                  style={{
                    width: '100%',
                    maxHeight: 240,
                    objectFit: 'contain',
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-sub)',
                  }}
                />
              )}

              {textPreview !== null && (
                <pre
                  className="mono"
                  style={{
                    margin: 0,
                    padding: 12,
                    maxHeight: 200,
                    overflow: 'auto',
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-sub)',
                    fontSize: '0.75rem',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {textPreview}
                </pre>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
