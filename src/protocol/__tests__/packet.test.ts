import { describe, expect, it } from 'vitest';
import {
  decodePacket,
  encodeDataPacket,
  encodeManifestPacket,
  formatPacketQrString,
  type TransferManifest,
} from '../packet';
import { sha256 } from '../sha256';

describe('Packet framing and CRC integrity', () => {
  it('roundtrips v2 manifest and compact 8-byte data packets and rejects bit flips', async () => {
    const raw = new TextEncoder().encode('Halo BeamQR optical transfer test!');
    const hash = await sha256(raw);
    const manifest: TransferManifest = {
      sessionId: 0xbeef,
      mode: 'lt',
      compressed: true,
      compressionFormat: 'deflate-raw',
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
      expect(decodedM.manifest.sessionId).toBe(0xbeef);
      expect(decodedM.manifest.fileName).toBe('laporan-rahasia-2026.pdf');
      expect(decodedM.manifest.mode).toBe('lt');
      expect(decodedM.manifest.compressed).toBe(true);
      expect(decodedM.manifest.compressionFormat).toBe('deflate-raw');
      expect(decodedM.manifest.sha256).toEqual(hash);
    }

    // Flip 1 character in the Base45 QR string -> CRC must reject
    const tampered = mQr.slice(0, -1) + (mQr.endsWith('0') ? '1' : '0');
    expect(decodePacket(tampered)).toBeNull();

    const payload = new Uint8Array(64).map((_, i) => (i * 11) & 0xff);
    const encodedD = encodeDataPacket(0xbeef, 42, payload);
    expect(encodedD.length).toBe(8 + payload.length);
    const dQr = formatPacketQrString(encodedD);
    const decodedD = decodePacket(dQr);
    expect(decodedD?.kind).toBe('data');
    if (decodedD?.kind === 'data') {
      expect(decodedD.sessionId).toBe(0xbeef);
      expect(decodedD.seqOrIndex).toBe(42);
      expect(decodedD.payload).toEqual(payload);
    }
  });

  it('preserves leading Base45 space characters in ReceiveSession ingestion', async () => {
    const { ReceiveSession } = await import('../transferSession');
    // 0xb0cd % 45 === 36 (' '), so manifest starts with a Base45 space; 0xb219 % 45 === 36 for data
    const hash = await sha256(new Uint8Array([1, 2, 3]));
    const manifest: TransferManifest = {
      sessionId: 0xcdad,
      mode: 'cyclic',
      compressed: false,
      compressionFormat: 'none',
      k: 1,
      blockSize: 3,
      origSize: 3,
      compSize: 3,
      sha256: hash,
      fileName: 'space.bin',
      mimeType: 'application/octet-stream',
    };
    const mQr = formatPacketQrString(encodeManifestPacket(manifest));
    expect(mQr.startsWith(' ')).toBe(true);

    const dQr = formatPacketQrString(encodeDataPacket(0xcdad, 0, new Uint8Array([1, 2, 3])));
    const rx = new ReceiveSession();
    const res1 = await rx.ingestQrText(mQr);
    expect(res1.snapshot.invalidScans).toBe(0);
    expect(res1.snapshot.status).toBe('receiving');

    const res2 = await rx.ingestQrText(dQr);
    expect(res2.snapshot.invalidScans).toBe(0);
    expect(res2.snapshot.status).toBe('completed');
    expect(res2.snapshot.recoveredBytes).toEqual(new Uint8Array([1, 2, 3]));

    // Also test a data packet whose own Base45 string starts with ' ' (0xb208 % 45 === 36)
    const spaceDataQr = formatPacketQrString(encodeDataPacket(0x0800, 0, new Uint8Array([7, 8, 9])));
    expect(spaceDataQr.startsWith(' ')).toBe(true);
    const decodedSpaceData = decodePacket(spaceDataQr);
    expect(decodedSpaceData?.kind).toBe('data');
  });
});
