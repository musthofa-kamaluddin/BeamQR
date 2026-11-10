import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';

interface OpticalBeamDemoProps {
  themeKey: 'light' | 'dark';
}

interface FlyingPacket {
  x: number;
  lane: number;
  kind: 'manifest' | 'deg1' | 'xor';
  dropped: boolean;
  targetIdx: number;
  alpha: number;
}

const GRID_TOTAL = 36; // 6x6 receiver matrix

export function OpticalBeamDemo({ themeKey }: OpticalBeamDemoProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [paused, setPaused] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  const [cycleCount, setCycleCount] = useState(0);
  const [stats, setStats] = useState({ solved: 0, xorBuffered: 0, frame: 0, verified: false });
  const resetNonceRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastTime = performance.now();
    let emitTimer = 0;
    let holdTimer = 0;
    let frameNum = 0;

    // 0 = empty, 1 = amber (XOR buffered), 2 = mint (solved)
    const rxBlocks = new Uint8Array(GRID_TOTAL);
    const packets: FlyingPacket[] = [];
    let solvedCount = 0;
    let xorCount = 0;
    let verified = false;

    const resetSim = () => {
      rxBlocks.fill(0);
      packets.length = 0;
      solvedCount = 0;
      xorCount = 0;
      verified = false;
      holdTimer = 0;
      frameNum = 0;
      setStats({ solved: 0, xorBuffered: 0, frame: 0, verified: false });
    };

    if (paused && resetNonceRef.current === 0) {
      // Static crisp locked state when reduced motion is preferred on initial load
      rxBlocks.fill(2);
      solvedCount = GRID_TOTAL;
      verified = true;
    }

    const palette =
      themeKey === 'dark'
        ? {
            bg: '#0d131a',
            panel: '#141d27',
            border: '#273547',
            ink: '#edf2f7',
            muted: '#33455a',
            mint: '#22d3a6',
            amber: '#f5a623',
            sky: '#38bdf8',
            qrLight: '#fcfaf4',
            qrDark: '#0b0e12',
          }
        : {
            bg: '#ebe5d8',
            panel: '#fcfaf4',
            border: '#c6bfb0',
            ink: '#131820',
            muted: '#d5cebd',
            mint: '#059669',
            amber: '#d97706',
            sky: '#0284c7',
            qrLight: '#ffffff',
            qrDark: '#131820',
          };

    const drawPixelQr = (ox: number, oy: number, size: number, seed: number) => {
      const cell = Math.floor(size / 9);
      const box = cell * 9;
      ctx.fillStyle = palette.qrLight;
      ctx.fillRect(ox, oy, box, box);
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 2;
      ctx.strokeRect(ox, oy, box, box);

      const drawFinder = (fx: number, fy: number) => {
        ctx.fillStyle = palette.qrDark;
        ctx.fillRect(ox + fx * cell, oy + fy * cell, cell * 3, cell * 3);
        ctx.fillStyle = palette.qrLight;
        ctx.fillRect(ox + (fx + 1) * cell, oy + (fy + 1) * cell, cell, cell);
      };

      drawFinder(1, 1);
      drawFinder(5, 1);
      drawFinder(1, 5);

      let s = (seed * 2654435761) >>> 0;
      for (let r = 1; r < 8; r++) {
        for (let c = 1; c < 8; c++) {
          const inFinder =
            (r <= 3 && c <= 3) || (r <= 3 && c >= 5) || (r >= 5 && c <= 3);
          if (inFinder) continue;
          s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
          if ((s >>> 28) % 2 === 0) {
            ctx.fillStyle =
              seed % 7 === 0 && (r + c) % 3 === 0 ? palette.sky : palette.qrDark;
            ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
          }
        }
      }
    };

    const stepAndDraw = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 460;
      const h = 230;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (!paused) {
        if (verified) {
          holdTimer += dt;
          if (holdTimer > 2.1) {
            resetSim();
          }
        } else {
          emitTimer += dt;
          if (emitTimer >= 0.14) {
            emitTimer = 0;
            frameNum++;
            const missingIndices: number[] = [];
            for (let i = 0; i < GRID_TOTAL; i++) {
              if (rxBlocks[i] !== 2) missingIndices.push(i);
            }

            if (missingIndices.length > 0) {
              const kind: FlyingPacket['kind'] =
                frameNum % 7 === 0 ? 'manifest' : frameNum % 3 === 0 ? 'deg1' : 'xor';
              const targetIdx =
                missingIndices[(frameNum * 7 + missingIndices.length) % missingIndices.length];
              packets.push({
                x: 0,
                lane: frameNum % 3,
                kind,
                dropped: frameNum % 6 === 4,
                targetIdx,
                alpha: 1,
              });
            }
          }
        }
      }

      // Draw pixel background & lanes
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, w, h);

      // Subtle pixel grid dots
      ctx.fillStyle = palette.border;
      for (let gx = 12; gx < w; gx += 16) {
        for (let gy = 12; gy < h; gy += 16) {
          ctx.fillRect(gx, gy, 1, 1);
        }
      }

      const txSize = Math.min(96, Math.floor(w * 0.22));
      const rxSize = txSize;
      const txX = 18;
      const rxX = w - rxSize - 18;
      const cy = Math.floor((h - txSize) / 2);

      const beamStart = txX + txSize + 14;
      const beamEnd = rxX - 14;
      const beamWidth = Math.max(40, beamEnd - beamStart);

      // Optical lanes
      for (let l = 0; l < 3; l++) {
        const ly = cy + Math.floor((txSize / 4) * (l + 1));
        ctx.fillStyle = palette.border;
        for (let px = beamStart; px < beamEnd; px += 10) {
          ctx.fillRect(px, ly, 4, 2);
        }
      }

      // Update & draw flying pixel packets
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i];
        if (!paused) {
          p.x += dt * 1.45;
          if (p.dropped && p.x > 0.45) {
            p.alpha = Math.max(0, 1 - (p.x - 0.45) * 3.5);
          }
        }

        const px = Math.round(beamStart + p.x * beamWidth);
        const py = Math.round(cy + Math.floor((txSize / 4) * (p.lane + 1)) - 4);

        ctx.globalAlpha = p.alpha;
        ctx.fillStyle =
          p.kind === 'manifest'
            ? palette.sky
            : p.kind === 'deg1'
              ? palette.mint
              : palette.amber;
        ctx.fillRect(px, py, 8, 8);
        ctx.globalAlpha = 1;

        if (!paused && p.dropped && p.alpha <= 0.02) {
          packets.splice(i, 1);
          continue;
        }

        if (!paused && p.x >= 1) {
          packets.splice(i, 1);
          if (p.kind === 'deg1') {
            rxBlocks[p.targetIdx] = 2;
            // Peel one adjacent amber block too to visualize cascade
            for (let j = 0; j < GRID_TOTAL; j++) {
              if (rxBlocks[j] === 1) {
                rxBlocks[j] = 2;
                break;
              }
            }
          } else if (p.kind === 'xor') {
            if (rxBlocks[p.targetIdx] === 0) {
              rxBlocks[p.targetIdx] = 1;
            } else if (rxBlocks[p.targetIdx] === 1) {
              rxBlocks[p.targetIdx] = 2;
            }
          }

          let sCount = 0;
          let xCount = 0;
          for (let j = 0; j < GRID_TOTAL; j++) {
            if (rxBlocks[j] === 2) sCount++;
            else if (rxBlocks[j] === 1) xCount++;
          }
          solvedCount = sCount;
          xorCount = xCount;
          if (sCount === GRID_TOTAL && !verified) {
            verified = true;
          }
          setStats({
            solved: solvedCount,
            xorBuffered: xorCount,
            frame: frameNum,
            verified,
          });
        }
      }

      // Draw TX Mini Pixel QR
      drawPixelQr(txX, cy, txSize, frameNum);

      // Draw RX 6x6 Pixel Matrix
      ctx.fillStyle = palette.panel;
      ctx.fillRect(rxX - 4, cy - 4, rxSize + 8, rxSize + 8);
      ctx.strokeStyle = verified ? palette.mint : palette.border;
      ctx.lineWidth = 2;
      ctx.strokeRect(rxX - 4, cy - 4, rxSize + 8, rxSize + 8);

      const gap = 3;
      const cell = Math.floor((rxSize - gap * 5) / 6);
      const gridOffset = Math.floor((rxSize - (cell * 6 + gap * 5)) / 2);
      for (let i = 0; i < GRID_TOTAL; i++) {
        const r = Math.floor(i / 6);
        const c = i % 6;
        const bx = rxX + gridOffset + c * (cell + gap);
        const by = cy + gridOffset + r * (cell + gap);
        const st = rxBlocks[i];
        ctx.fillStyle = st === 2 ? palette.mint : st === 1 ? palette.amber : palette.muted;
        ctx.fillRect(bx, by, cell, cell);
      }

      // Labels
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillStyle = palette.ink;
      ctx.fillText('TX // QR BEAM', txX, cy - 10);
      ctx.fillText(verified ? 'RX // SHA-256 OK' : 'RX // PEELING', rxX - 4, cy - 10);

      if (!paused) {
        rafId = requestAnimationFrame(stepAndDraw);
      }
    };

    rafId = requestAnimationFrame(stepAndDraw);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [paused, themeKey, cycleCount]);

  return (
    <div className="pixel-card demo-shell">
      <div className="demo-bar">
        <span className="pixel-badge" data-tone="sky">
          LIVE SIMULASI LT-CODE
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn btn-sm"
            aria-pressed={paused}
            aria-label={paused ? 'Putar simulasi beam optik' : 'Jeda simulasi beam optik'}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
            {paused ? 'Putar' : 'Jeda'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            aria-label="Ulang simulasi beam optik"
            onClick={() => {
              resetNonceRef.current++;
              setPaused(false);
              setCycleCount((c) => c + 1);
            }}
          >
            <RotateCcw size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="demo-canvas"
        role="img"
        aria-label="Animasi paket piksel mengalir dari QR pengirim ke matriks penerima"
      />

      <div className="demo-footer mono">
        <span>
          BLOK: <strong>{stats.solved}</strong>/{GRID_TOTAL}
        </span>
        <span style={{ color: 'var(--amber)' }}>XOR: {stats.xorBuffered}</span>
        <span style={{ color: stats.verified ? 'var(--accent)' : 'var(--fg-secondary)' }}>
          {stats.verified ? 'VERIFIED OK' : `FRAME #${stats.frame}`}
        </span>
      </div>
    </div>
  );
}
