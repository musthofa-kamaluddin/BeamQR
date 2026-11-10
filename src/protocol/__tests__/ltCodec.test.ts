import { describe, expect, it } from 'vitest';
import { LtDecoder, LtEncoder } from '../ltCodec';
import { prepareBroadcast, ReceiveSession } from '../transferSession';

function makePseudoRandomBytes(length: number, seed = 1337): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = (x >>> 24) & 0xff;
  }
  return out;
}

describe('LT Fountain Codec & TransferSession', () => {
  it('decodes cleanly with 0% loss on first sweep', () => {
    const payload = makePseudoRandomBytes(4096);
    const encoder = new LtEncoder(0x12345678, payload, 200);
    const decoder = new LtDecoder(0x12345678, encoder.k, 200);

    for (let s = 0; s < encoder.k; s++) {
      const droplet = encoder.encodeDroplet(s);
      const res = decoder.ingestPacket(droplet.seed, droplet.payload);
      expect(res.accepted).toBe(true);
    }

    expect(decoder.isComplete()).toBe(true);
    expect(decoder.reconstruct(payload.length)).toEqual(payload);
  });

  it('decodes even when joining mid-stream and dropping 45% of frames', () => {
    const payload = makePseudoRandomBytes(16000, 99);
    const encoder = new LtEncoder(0xabcdef01, payload, 200);
    const decoder = new LtDecoder(0xabcdef01, encoder.k, 200);

    // Skip the entire initial sweep (first k frames) AND drop 45% of subsequent frames!
    let seq = encoder.k + 3;
    let guard = 0;
    while (!decoder.isComplete() && guard < encoder.k * 20) {
      const droplet = encoder.encodeDroplet(seq++);
      guard++;
      // Deterministic pseudo-random frame drop (~45%)
      if ((guard * 37) % 100 < 45) continue;
      decoder.ingestPacket(droplet.seed, droplet.payload);
    }

    expect(decoder.isComplete()).toBe(true);
    expect(decoder.reconstruct(payload.length)).toEqual(payload);
  });

  it('handles tiny files (k = 1 and k = 3) cleanly', () => {
    for (const size of [12, 450]) {
      const payload = makePseudoRandomBytes(size, size);
      const encoder = new LtEncoder(0x55aa55aa, payload, 200);
      const decoder = new LtDecoder(0x55aa55aa, encoder.k, 200);

      let seq = encoder.k; // even skipping systematic pass
      while (!decoder.isComplete() && seq < 500) {
        const d = encoder.encodeDroplet(seq++);
        decoder.ingestPacket(d.seed, d.payload);
      }

      expect(decoder.isComplete()).toBe(true);
      expect(decoder.reconstruct(payload.length)).toEqual(payload);
    }
  });

  it('end-to-end ReceiveSession buffers pre-manifest packets and verifies SHA-256', async () => {
    const original = new TextEncoder().encode(
      '{"project":"BeamQR","message":"Offline optical transfer test! "} '.repeat(120),
    );

    const broadcast = await prepareBroadcast({
      bytes: original,
      fileName: 'telemetry.json',
      mimeType: 'application/json',
      blockSize: 180,
      mode: 'lt',
      enableCompression: true,
      manifestEveryN: 6,
    });

    const receiver = new ReceiveSession();
    // Skip frame 0 (first manifest) so receiver starts with data packets BEFORE manifest!
    for (let f = 1; f < 400; f++) {
      const frame = broadcast.generateFrameQr(f);
      // Drop every 3rd frame
      if (f % 3 === 0 && !frame.isManifest) continue;
      const { snapshot } = await receiver.ingestQrText(frame.qrText);
      if (snapshot.status === 'completed') break;
    }

    const final = receiver.getSnapshot();
    expect(final.status).toBe('completed');
    expect(final.manifest?.fileName).toBe('telemetry.json');
    expect(final.manifest?.compressed).toBe(true);
    expect(final.recoveredBytes).toEqual(original);
    expect(final.verifiedSha256Hex).toHaveLength(64);
  });

  it('end-to-end cyclic mode works cleanly when frames wrap around', async () => {
    const original = makePseudoRandomBytes(3200, 777);
    const broadcast = await prepareBroadcast({
      bytes: original,
      fileName: 'binary.dat',
      mimeType: 'application/octet-stream',
      blockSize: 220,
      mode: 'cyclic',
      enableCompression: false,
      manifestEveryN: 5,
    });

    const receiver = new ReceiveSession();
    for (let f = 0; f < 200; f++) {
      const frame = broadcast.generateFrameQr(f);
      // Drop first pass odd frames, catch them on wrap-around
      if (f < 25 && f % 2 === 1 && !frame.isManifest) continue;
      const { snapshot } = await receiver.ingestQrText(frame.qrText);
      if (snapshot.status === 'completed') break;
    }

    const final = receiver.getSnapshot();
    expect(final.status).toBe('completed');
    expect(final.recoveredBytes).toEqual(original);
  });
});
