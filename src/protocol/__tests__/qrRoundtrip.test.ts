import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import {
  createMonoQrRgba,
  decodeSingleQr,
  type JsQrDecoderFn,
} from '../qrOptical';
import { decodePacket } from '../packet';
import { prepareBroadcast, ReceiveSession } from '../transferSession';

const decodeQr = jsQR as unknown as JsQrDecoderFn;

describe('1x1 BnW QR optical pixel roundtrip with v2 8B framing & level-9 fflate compression', () => {
  it('encodes Base45 1x1 BnW QR frames and recovers bit-exact text via jsQR', async () => {
    const original = new TextEncoder().encode(
      'Halo! Ini tes end-to-end 1x1 BnW QR optik tanpa internet menggunakan Base45 + v2 8B header + fflate Deflate Level-9.\n'.repeat(
        30,
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

    expect(broadcast.manifest.compressed).toBe(true);
    expect(broadcast.manifest.compressionFormat).toBe('deflate-raw');
    expect(broadcast.manifest.compSize).toBeLessThan(original.length);

    const receiver = new ReceiveSession();

    for (let f = 0; f < 80; f++) {
      const frame = broadcast.generateFrameQr(f);
      if (f === 2) continue;

      const { rgba, side } = createMonoQrRgba(frame.qrText, 'L', 4, 4);
      const decodedText = decodeSingleQr(decodeQr, rgba, side, side);
      expect(decodedText).toBe(frame.qrText);

      const { snapshot } = await receiver.ingestQrText(decodedText!);
      if (snapshot.status === 'completed') break;
    }

    const done = receiver.getSnapshot();
    expect(done.status).toBe('completed');
    expect(done.manifest?.fileName).toBe('uji-optik.txt');
    expect(done.recoveredBytes).toEqual(original);
  });

  it('skips compression automatically for incompressible binary payloads while keeping 8B data header', async () => {
    const original = new Uint8Array(640);
    let seed = 0x12345678;
    for (let i = 0; i < original.length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      original[i] = (seed >>> 24) & 0xff;
    }

    for (let trial = 0; trial < 15; trial++) {
      const broadcast = await prepareBroadcast({
        bytes: original,
        fileName: 'raw-sample.bin',
        mimeType: 'application/octet-stream',
        blockSize: 160,
        mode: 'cyclic',
        enableCompression: true,
        manifestEveryN: 6,
      });

      expect(broadcast.manifest.compressed).toBe(false);
      expect(broadcast.manifest.compressionFormat).toBe('none');
      expect(broadcast.manifest.compSize).toBe(original.length);

      const receiver = new ReceiveSession();

      for (let f = 0; f < 30; f++) {
        const frame = broadcast.generateFrameQr(f);
        const { rgba, side } = createMonoQrRgba(frame.qrText, 'M', 4, 4);
        const decodedText = decodeSingleQr(decodeQr, rgba, side, side);
        expect(decodedText).toBe(frame.qrText);

        const pkt = decodePacket(decodedText!);
        expect(pkt).not.toBeNull();
        if (pkt?.kind === 'data') {
          expect(pkt.sessionId).toBe(broadcast.manifest.sessionId);
          expect(pkt.payload.length).toBe(160);
        }

        const { snapshot } = await receiver.ingestQrText(decodedText!);
        if (snapshot.status === 'completed') break;
      }

      const done = receiver.getSnapshot();
      expect({
        trial,
        sidHex: broadcast.manifest.sessionId.toString(16),
        status: done.status,
        solved: done.solvedBlocks,
        total: done.totalBlocks,
        invalid: done.invalidScans,
        err: done.errorMessage,
      }).toMatchObject({ status: 'completed', solved: 4, total: 4, invalid: 0, err: null });
      expect(done.recoveredBytes).toEqual(original);
    }
  });
});
