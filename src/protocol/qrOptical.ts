import QRCode from 'qrcode';
import type { QRCode as JsQrResult } from 'jsqr';

export type GridLayout = '1x1' | '2x1' | '2x2';
export type ColorMode = 'mono' | 'rgb';
export type OpticalColorScanMode = 'auto' | 'mono' | 'rgb';

export type JsQrDecoderFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' },
) => JsQrResult | null;

function createAlignedQrMatrices(
  texts: [string, string, string],
  eccLevel: 'L' | 'M',
) {
  const initial = texts.map((text) =>
    QRCode.create([{ data: text, mode: 'alphanumeric' }], {
      errorCorrectionLevel: eccLevel,
    }),
  );
  const maxVersion = Math.max(...initial.map((q) => q.version));
  return initial.map((q, idx) =>
    q.version === maxVersion
      ? q
      : QRCode.create([{ data: texts[idx], mode: 'alphanumeric' }], {
          errorCorrectionLevel: eccLevel,
          version: maxVersion,
        }),
  );
}

export function createMonoQrRgba(
  text: string,
  eccLevel: 'L' | 'M',
  scale = 4,
  margin = 4,
): { rgba: Uint8ClampedArray; side: number } {
  const qr = QRCode.create([{ data: text, mode: 'alphanumeric' }], {
    errorCorrectionLevel: eccLevel,
  });
  const modules = qr.modules.size;
  const side = (modules + margin * 2) * scale;
  const rgba = new Uint8ClampedArray(side * side * 4);
  rgba.fill(255);

  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.modules.get(row, col)) {
        const y0 = (row + margin) * scale;
        const x0 = (col + margin) * scale;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const p = ((y0 + dy) * side + (x0 + dx)) * 4;
            rgba[p] = 0;
            rgba[p + 1] = 0;
            rgba[p + 2] = 0;
            rgba[p + 3] = 255;
          }
        }
      }
    }
  }

  return { rgba, side };
}

export function createRgbQrRgba(
  texts: [string, string, string],
  eccLevel: 'L' | 'M',
  scale = 4,
  margin = 4,
): { rgba: Uint8ClampedArray; side: number } {
  const [qR, qG, qB] = createAlignedQrMatrices(texts, eccLevel);
  const modules = qR.modules.size;
  const side = (modules + margin * 2) * scale;
  const rgba = new Uint8ClampedArray(side * side * 4);
  rgba.fill(255);

  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      const rVal = qR.modules.get(row, col) ? 0 : 255;
      const gVal = qG.modules.get(row, col) ? 0 : 255;
      const bVal = qB.modules.get(row, col) ? 0 : 255;
      if (rVal === 255 && gVal === 255 && bVal === 255) continue;

      const y0 = (row + margin) * scale;
      const x0 = (col + margin) * scale;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const p = ((y0 + dy) * side + (x0 + dx)) * 4;
          rgba[p] = rVal;
          rgba[p + 1] = gVal;
          rgba[p + 2] = bVal;
          rgba[p + 3] = 255;
        }
      }
    }
  }

  return { rgba, side };
}

export function renderQrToCanvas(
  canvas: HTMLCanvasElement,
  texts: string[],
  colorMode: ColorMode,
  eccLevel: 'L' | 'M',
  displaySize = 440,
): void {
  const margin = 4;
  let buffer: { rgba: Uint8ClampedArray; side: number };

  if (colorMode === 'rgb') {
    const t0 = texts[0];
    const t1 = texts[1] ?? t0;
    const t2 = texts[2] ?? t0;
    buffer = createRgbQrRgba([t0, t1, t2], eccLevel, 1, margin);
  } else {
    buffer = createMonoQrRgba(texts[0], eccLevel, 1, margin);
  }

  const offscreen = document.createElement('canvas');
  offscreen.width = buffer.side;
  offscreen.height = buffer.side;
  const offCtx = offscreen.getContext('2d');
  if (!offCtx) return;

  const imgData = offCtx.createImageData(buffer.side, buffer.side);
  imgData.data.set(buffer.rgba);
  offCtx.putImageData(imgData, 0, 0);

  if (canvas.width !== displaySize || canvas.height !== displaySize) {
    canvas.width = displaySize;
    canvas.height = displaySize;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, displaySize, displaySize);
  ctx.drawImage(offscreen, 0, 0, displaySize, displaySize);
}

/**
 * Checks whether the captured frame contains substantial color saturation
 * (indicating an RGB color-multiplexed QR frame).
 */
export function detectHighChroma(rgba: Uint8ClampedArray): boolean {
  let colorfulSamples = 0;
  let totalSamples = 0;
  // Sample every 24th pixel for O(1) negligible latency (<0.1ms)
  const step = 24 * 4;
  for (let i = 0; i < rgba.length; i += step) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min > 48) {
      colorfulSamples++;
    }
    totalSamples++;
  }
  return totalSamples > 0 && colorfulSamples / totalSamples >= 0.035;
}

function cropRgba(
  rgba: Uint8ClampedArray,
  srcWidth: number,
  x0: number,
  y0: number,
  cropW: number,
  cropH: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cropW * cropH * 4);
  const rowBytes = cropW * 4;
  for (let y = 0; y < cropH; y++) {
    const srcStart = ((y0 + y) * srcWidth + x0) * 4;
    out.set(rgba.subarray(srcStart, srcStart + rowBytes), y * rowBytes);
  }
  return out;
}

function qrBoxWidth(loc: JsQrResult['location']): number {
  const xs = [
    loc.topLeftCorner.x,
    loc.topRightCorner.x,
    loc.bottomRightCorner.x,
    loc.bottomLeftCorner.x,
  ];
  return Math.max(...xs) - Math.min(...xs);
}

function scanSingleChannelAll(
  decodeQr: JsQrDecoderFn,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  maxQrs: number,
  attemptBoth: boolean,
): string[] {
  const results: string[] = [];
  const options = {
    inversionAttempts: attemptBoth ? ('attemptBoth' as const) : ('dontInvert' as const),
  };

  const addUnique = (val: string | undefined) => {
    if (val && !results.includes(val)) {
      results.push(val);
    }
  };

  const first = decodeQr(rgba, width, height, options);
  if (first?.data) {
    addUnique(first.data);
    // If a single large QR already spans >52% of the frame, no multi-grid splitting needed
    if (maxQrs <= 1 || qrBoxWidth(first.location) > width * 0.52) {
      return results;
    }
  } else if (maxQrs <= 1) {
    return results;
  }

  // Scan 4 overlapping 58%x58% quadrants so 2x2 grids resolve cleanly without cross-tile locator confusion
  const qw = Math.max(32, Math.floor(width * 0.58));
  const qh = Math.max(32, Math.floor(height * 0.58));
  const rightX = Math.max(0, width - qw);
  const bottomY = Math.max(0, height - qh);

  const quadrants: Array<[number, number, number, number]> = [
    [0, 0, qw, qh],
    [rightX, 0, qw, qh],
    [0, bottomY, qw, qh],
    [rightX, bottomY, qw, qh],
  ];

  for (const [qx, qy, w, h] of quadrants) {
    if (results.length >= maxQrs) break;
    const sub = cropRgba(rgba, width, qx, qy, w, h);
    const hit = decodeQr(sub, w, h, options);
    addUnique(hit?.data);
  }

  // Fallback for centered 2x1 horizontal split if quadrants found fewer than 2 QRs
  if (results.length < 2 && maxQrs >= 2) {
    const hw = Math.max(32, Math.floor(width * 0.6));
    const halves: Array<[number, number, number, number]> = [
      [0, 0, hw, height],
      [Math.max(0, width - hw), 0, hw, height],
    ];
    for (const [hx, hy, w, h] of halves) {
      if (results.length >= maxQrs) break;
      const sub = cropRgba(rgba, width, hx, hy, w, h);
      const hit = decodeQr(sub, w, h, options);
      addUnique(hit?.data);
    }
  }

  return results;
}

function extractChannelGrayscale(rgba: Uint8ClampedArray, channelOffset: 0 | 1 | 2): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const v = rgba[i + channelOffset];
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}

export function decodeFrameQrs(
  decodeQr: JsQrDecoderFn,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    multiScan?: boolean;
    colorMode?: OpticalColorScanMode;
    attemptBoth?: boolean;
  },
): { texts: string[]; usedRgb: boolean } {
  const maxQrs = options?.multiScan === false ? 1 : 4;
  const colorMode = options?.colorMode ?? 'auto';
  const attemptBoth = options?.attemptBoth ?? false;

  const isRgb =
    colorMode === 'rgb' || (colorMode === 'auto' && detectHighChroma(rgba));

  if (!isRgb) {
    return {
      texts: scanSingleChannelAll(decodeQr, rgba, width, height, maxQrs, attemptBoth),
      usedRgb: false,
    };
  }

  const found = new Set<string>();
  for (const offset of [0, 1, 2] as const) {
    const gray = extractChannelGrayscale(rgba, offset);
    const channelResults = scanSingleChannelAll(decodeQr, gray, width, height, maxQrs, attemptBoth);
    for (const t of channelResults) {
      found.add(t);
    }
  }

  return {
    texts: Array.from(found),
    usedRgb: true,
  };
}
