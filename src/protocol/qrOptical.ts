import QRCode from 'qrcode';
import type { QRCode as JsQrResult } from 'jsqr';

export type JsQrDecoderFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' },
) => JsQrResult | null;

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
      if (!qr.modules.get(row, col)) continue;
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

  return { rgba, side };
}

export function renderMonoQrToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  eccLevel: 'L' | 'M',
  displaySize = 440,
): void {
  const margin = 4;
  const buffer = createMonoQrRgba(text, eccLevel, 1, margin);

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

export function decodeSingleQr(
  decodeQr: JsQrDecoderFn,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  attemptBoth = false,
): string | null {
  const result = decodeQr(rgba, width, height, {
    inversionAttempts: attemptBoth ? 'attemptBoth' : 'dontInvert',
  });
  return result?.data ?? null;
}
