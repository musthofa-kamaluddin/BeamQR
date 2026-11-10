import { describe, expect, it } from 'vitest';
import {
  decodePacket,
  encodeDataPacket,
  encodeManifestPacket,
  formatPacketQrString,
  type TransferManifest,
} from '../packet';
import { sha256 } from '../sha256';

describe('Packet framing and CRC32 integrity', () => {
  it('roundtrips manifest and data packets and rejects bit flips', async () => {
    const raw = new TextEncoder().encode('Halo BeamQR optical transfer test!');
    const hash = await sha256(raw);
    const manifest: TransferManifest = {
      sessionId: 0xdeadbeef,
      mode: 'lt',
      compressed: true,
      k: 12,
      blockSize: 240,
      origSize: raw.length,
      compSize: 28,
      sha256: hash,
      fileName: 'laporan-rahasia-2026.pdf',
      mimeType: 'application/pdf',
    };

    const mQr = formatPacketQrString(encodeManifestPacket(manifest));
    const decodedM = decodePacket(mQr);
    expect(decodedM?.kind).toBe('manifest');
    if (decodedM?.kind === 'manifest') {
      expect(decodedM.manifest.sessionId).toBe(0xdeadbeef);
      expect(decodedM.manifest.fileName).toBe('laporan-rahasia-2026.pdf');
      expect(decodedM.manifest.mode).toBe('lt');
      expect(decodedM.manifest.compressed).toBe(true);
      expect(decodedM.manifest.sha256).toEqual(hash);
    }

    // Flip 1 character in the Base45 QR string -> CRC must reject
    const tampered = mQr.slice(0, -1) + (mQr.endsWith('0') ? '1' : '0');
    expect(decodePacket(tampered)).toBeNull();

    const payload = new Uint8Array(64).map((_, i) => (i * 11) & 0xff);
    const dQr = formatPacketQrString(encodeDataPacket(0xdeadbeef, 42, payload));
    const decodedD = decodePacket(dQr);
    expect(decodedD?.kind).toBe('data');
    if (decodedD?.kind === 'data') {
      expect(decodedD.sessionId).toBe(0xdeadbeef);
      expect(decodedD.seqOrIndex).toBe(42);
      expect(decodedD.payload).toEqual(payload);
    }
  });
});
