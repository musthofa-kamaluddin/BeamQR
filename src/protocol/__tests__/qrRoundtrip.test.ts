import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import {
  createMonoQrRgba,
  createRgbQrRgba,
  decodeFrameQrs,
  type JsQrDecoderFn,
} from '../qrOptical';
import { prepareBroadcast, ReceiveSession } from '../transferSession';

const decodeQr = jsQR as unknown as JsQrDecoderFn;

function compose2x2Grid(
  tiles: Array<{ rgba: Uint8ClampedArray; side: number }>,
  gap = 20,
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const tileSide = Math.max(...tiles.map((t) => t.side));
  const totalSide = tileSide * 2 + gap * 3;
  const rgba = new Uint8ClampedArray(totalSide * totalSide * 4);
  rgba.fill(255);

  const offsets = [
    [gap, gap],
    [gap * 2 + tileSide, gap],
    [gap, gap * 2 + tileSide],
    [gap * 2 + tileSide, gap * 2 + tileSide],
  ];

  for (let t = 0; t < Math.min(4, tiles.length); t++) {
    const tile = tiles[t];
    const [ox, oy] = offsets[t];
    for (let y = 0; y < tile.side; y++) {
      for (let x = 0; x < tile.side; x++) {
        const src = (y * tile.side + x) * 4;
        const dst = ((oy + y) * totalSide + (ox + x)) * 4;
        rgba[dst] = tile.rgba[src];
        rgba[dst + 1] = tile.rgba[src + 1];
        rgba[dst + 2] = tile.rgba[src + 2];
        rgba[dst + 3] = 255;
      }
    }
  }

  return { rgba, width: totalSide, height: totalSide };
}

function simulateCameraBleed(rgba: Uint8ClampedArray): Uint8ClampedArray {
  // Simulates harsh real-world LCD-to-phone Bayer crosstalk (42% bleed) + warm white balance skew
  const noisy = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    noisy[i] = Math.min(255, Math.round(r * 0.65 + g * 0.22 + b * 0.12 + 18));
    noisy[i + 1] = Math.min(255, Math.round(g * 0.64 + r * 0.18 + b * 0.16 + 15));
    noisy[i + 2] = Math.min(255, Math.round(b * 0.56 + g * 0.22 + r * 0.1 + 12));
    noisy[i + 3] = 255;
  }
  return noisy;
}

describe('Full QR optical pixel roundtrip (Mono, 2x2 Quad Grid, RGB 3x, 2x2 RGB Turbo)', () => {
  it('encodes Alphanumeric Base45 QR frames and decodes them with jsQR', async () => {
    const original = new TextEncoder().encode(
      'Halo! Ini tes end-to-end QR optik tanpa internet menggunakan Base45 + LT Fountain Code.\n'.repeat(
        25,
      ),
    );

    const broadcast = await prepareBroadcast({
      bytes: original,
      fileName: 'uji-optik.txt',
      mimeType: 'text/plain',
      blockSize: 160,
      mode: 'lt',
      enableCompression: true,
      manifestEveryN: 5,
    });

    const receiver = new ReceiveSession();

    for (let f = 0; f < 80; f++) {
      const frame = broadcast.generateFrameQr(f);
      if (f === 2) continue;

      const { rgba, side } = createMonoQrRgba(frame.qrText, 'L', 4, 4);
      const { texts } = decodeFrameQrs(decodeQr, rgba, side, side, {
        multiScan: false,
        colorMode: 'mono',
      });
      expect(texts.length).toBe(1);

      const { snapshot } = await receiver.ingestBatch(texts);
      if (snapshot.status === 'completed') break;
    }

    const done = receiver.getSnapshot();
    expect(done.status).toBe('completed');
    expect(done.manifest?.fileName).toBe('uji-optik.txt');
    expect(done.recoveredBytes).toEqual(original);
  });

  it('decodes 2x2 Mono Quad-Grid (4 independent QRs in 1 frame)', async () => {
    const original = new TextEncoder().encode(
      'Quad grid optical speed boost payload data! '.repeat(35),
    );

    const broadcast = await prepareBroadcast({
      bytes: original,
      fileName: 'quad-test.txt',
      mimeType: 'text/plain',
      blockSize: 100,
      mode: 'lt',
      enableCompression: true,
    });

    const receiver = new ReceiveSession();

    for (let f = 0; f < 25; f++) {
      const batch = broadcast.generateBatchQr(f, 4);
      const tiles = batch.map((s) => createMonoQrRgba(s.qrText, 'L', 3, 4));
      const frameImg = compose2x2Grid(tiles, 24);
      const { texts, usedRgb } = decodeFrameQrs(
        decodeQr,
        frameImg.rgba,
        frameImg.width,
        frameImg.height,
        { multiScan: true, colorMode: 'auto' },
      );

      expect(usedRgb).toBe(false);
      expect(texts.length).toBe(4);

      const { snapshot } = await receiver.ingestBatch(texts);
      if (snapshot.status === 'completed') break;
    }

    const done = receiver.getSnapshot();
    expect(done.status).toBe('completed');
    expect(done.recoveredBytes).toEqual(original);
  });

  it('decodes RGB 3-Channel Color QR even under simulated screen-to-camera color bleed', async () => {
    const original = new Uint8Array(1200).map((_, i) => (i * 41 + 7) & 0xff);

    const broadcast = await prepareBroadcast({
      bytes: original,
      fileName: 'rgb-sample.bin',
      mimeType: 'application/octet-stream',
      blockSize: 120,
      mode: 'lt',
      enableCompression: false,
    });

    const receiver = new ReceiveSession();

    for (let f = 0; f < 20; f++) {
      const batch = broadcast.generateBatchQr(f, 3);
      const rawRgb = createRgbQrRgba(
        [batch[0].qrText, batch[1].qrText, batch[2].qrText],
        'L',
        4,
        4,
      );
      const cameraImg = simulateCameraBleed(rawRgb.rgba);
      const { texts, usedRgb } = decodeFrameQrs(decodeQr, cameraImg, rawRgb.side, rawRgb.side, {
        multiScan: false,
        colorMode: 'auto',
      });

      expect(usedRgb).toBe(true);
      expect(texts.length).toBe(3);

      const { snapshot } = await receiver.ingestBatch(texts);
      if (snapshot.status === 'completed') break;
    }

    const done = receiver.getSnapshot();
    expect(done.status).toBe('completed');
    expect(done.recoveredBytes).toEqual(original);
  });

  it('decodes 2x2 RGB Turbo Grid (12 packets per frame)', async () => {
    const original = new Uint8Array(2400).map((_, i) => (i * 19 + 3) & 0xff);

    const broadcast = await prepareBroadcast({
      bytes: original,
      fileName: 'turbo-12x.bin',
      mimeType: 'application/octet-stream',
      blockSize: 100,
      mode: 'lt',
      enableCompression: false,
    });

    const receiver = new ReceiveSession();

    for (let f = 0; f < 10; f++) {
      const batch = broadcast.generateBatchQr(f, 12);
      const tiles = [0, 1, 2, 3].map((cell) =>
        createRgbQrRgba(
          [batch[cell * 3].qrText, batch[cell * 3 + 1].qrText, batch[cell * 3 + 2].qrText],
          'L',
          3,
          4,
        ),
      );
      const frameImg = compose2x2Grid(tiles, 24);
      const { texts, usedRgb } = decodeFrameQrs(
        decodeQr,
        frameImg.rgba,
        frameImg.width,
        frameImg.height,
        { multiScan: true, colorMode: 'auto' },
      );

      expect(usedRgb).toBe(true);
      expect(texts.length).toBe(12);

      const { snapshot } = await receiver.ingestBatch(texts);
      if (snapshot.status === 'completed') break;
    }

    const done = receiver.getSnapshot();
    expect(done.status).toBe('completed');
    expect(done.recoveredBytes).toEqual(original);
  });
});
