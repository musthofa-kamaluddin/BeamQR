import { useEffect, useRef } from 'react';
import type { BlockState } from '../protocol/ltCodec';

interface BlockMatrixProps {
  states: BlockState[];
  totalBlocks: number;
  solvedBlocks: number;
  themeKey?: string;
}

export function BlockMatrix({ states, totalBlocks, solvedBlocks, themeKey }: BlockMatrixProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const count = Math.max(totalBlocks, states.length, 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = canvas.clientWidth || 360;

    // Choose column density automatically so blocks remain crisp
    const cols = count <= 24 ? 8 : count <= 96 ? 16 : count <= 300 ? 25 : 40;
    const rows = Math.ceil(count / cols);
    const gap = count > 250 ? 2 : 3;
    const padding = 8;
    const cellSize = Math.max(4, Math.floor((cssWidth - padding * 2 - gap * (cols - 1)) / cols));
    const cssHeight = Math.max(48, padding * 2 + rows * cellSize + Math.max(0, rows - 1) * gap);

    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.height = `${cssHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const isDark = themeKey === 'dark';

    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const colorSolved = isDark ? '#22d3a6' : '#059669';
    const colorPartial = isDark ? '#f5a623' : '#d97706';
    const colorMissing = isDark ? '#232f3e' : '#d5cebd';

    for (let i = 0; i < count; i++) {
      const state = states[i] ?? 'missing';
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = padding + c * (cellSize + gap);
      const y = padding + r * (cellSize + gap);

      ctx.fillStyle =
        state === 'solved' ? colorSolved : state === 'partial' ? colorPartial : colorMissing;
      ctx.fillRect(x, y, cellSize, cellSize);
    }
  }, [states, totalBlocks, themeKey]);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <canvas
        ref={canvasRef}
        className="matrix-canvas"
        role="img"
        aria-label={`Peta blok transfer: ${solvedBlocks} dari ${totalBlocks} blok selesai`}
      />
      <div className="matrix-legend">
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--accent)' }} />
          Selesai ({solvedBlocks})
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--warn)' }} />
          Terbuffered (XOR)
        </span>
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: 'var(--border-strong)' }} />
          Belum diterima ({Math.max(0, totalBlocks - solvedBlocks)})
        </span>
      </div>
    </div>
  );
}
