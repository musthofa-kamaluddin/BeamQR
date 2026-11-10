import { decodeBase45, encodeBase45 } from './base45';
import type { CompressionKind } from './compress';
import { crc32 } from './crc32';

export const MAGIC_0 = 0x42; // 'B'
export const MAGIC_1 = 0x51; // 'Q'
export const PROTOCOL_VERSION = 1;

export type TransferMode = 'lt' | 'cyclic';

export interface TransferManifest {
  sessionId: number;
  mode: TransferMode;
  compressed: boolean;
  compressionFormat?: CompressionKind;
  k: number;
  blockSize: number;
  origSize: number;
  compSize: number;
  sha256: Uint8Array;
  fileName: string;
  mimeType: string;
}

export interface ManifestPacket {
  kind: 'manifest';
  manifest: TransferManifest;
}

export interface DataPacket {
  kind: 'data';
  sessionId: number;
  seqOrIndex: number;
  payload: Uint8Array;
}

export type DecodedPacket = ManifestPacket | DataPacket;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function truncateUtf8(text: string, maxBytes: number): Uint8Array {
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return bytes;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
    end--;
  }
  return bytes.slice(0, end);
}

export function encodeManifestPacket(manifest: TransferManifest): Uint8Array {
  const nameBytes = truncateUtf8(manifest.fileName || 'file.bin', 180);
  const mimeBytes = truncateUtf8(manifest.mimeType || 'application/octet-stream', 80);

  const totalLen = 57 + nameBytes.length + mimeBytes.length + 4;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  buf[0] = MAGIC_0;
  buf[1] = MAGIC_1;
  buf[2] = PROTOCOL_VERSION;
  buf[3] = 0x00;

  view.setUint32(4, manifest.sessionId >>> 0, false);
  const isRawDeflate = manifest.compressionFormat === 'deflate-raw';
  const flags =
    (manifest.compressed ? 1 : 0) |
    (manifest.mode === 'cyclic' ? 2 : 0) |
    (manifest.compressed && isRawDeflate ? 4 : 0);
  buf[8] = flags;
  view.setUint16(9, manifest.k, false);
  view.setUint16(11, manifest.blockSize, false);
  view.setUint32(13, manifest.origSize >>> 0, false);
  view.setUint32(17, manifest.compSize >>> 0, false);

  buf.set(manifest.sha256.subarray(0, 32), 21);

  let pos = 53;
  view.setUint16(pos, nameBytes.length, false);
  pos += 2;
  buf.set(nameBytes, pos);
  pos += nameBytes.length;

  view.setUint16(pos, mimeBytes.length, false);
  pos += 2;
  buf.set(mimeBytes, pos);
  pos += mimeBytes.length;

  const checksum = crc32(buf, pos);
  view.setUint32(pos, checksum, false);
  return buf;
}

export function encodeDataPacket(
  sessionId: number,
  seqOrIndex: number,
  payload: Uint8Array,
): Uint8Array {
  const totalLen = 12 + payload.length + 4;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  buf[0] = MAGIC_0;
  buf[1] = MAGIC_1;
  buf[2] = PROTOCOL_VERSION;
  buf[3] = 0x01;

  view.setUint32(4, sessionId >>> 0, false);
  view.setUint32(8, seqOrIndex >>> 0, false);
  buf.set(payload, 12);

  const checksum = crc32(buf, 12 + payload.length);
  view.setUint32(12 + payload.length, checksum, false);
  return buf;
}

export function formatPacketQrString(packetBytes: Uint8Array): string {
  return encodeBase45(packetBytes);
}

export function decodePacket(qrText: string): DecodedPacket | null {
  const bytes = decodeBase45(qrText);
  if (!bytes || bytes.length < 16) return null;

  if (bytes[0] !== MAGIC_0 || bytes[1] !== MAGIC_1 || bytes[2] !== PROTOCOL_VERSION) {
    return null;
  }

  const payloadEnd = bytes.length - 4;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expectedCrc = view.getUint32(payloadEnd, false);
  if (crc32(bytes, payloadEnd) !== expectedCrc) {
    return null;
  }

  const type = bytes[3];
  const sessionId = view.getUint32(4, false);

  if (type === 0x00) {
    if (payloadEnd < 57) return null;
    const flags = bytes[8];
    const compressed = (flags & 1) !== 0;
    const mode: TransferMode = (flags & 2) !== 0 ? 'cyclic' : 'lt';
    const compressionFormat: CompressionKind = !compressed
      ? 'none'
      : (flags & 4) !== 0
        ? 'deflate-raw'
        : 'deflate';
    const k = view.getUint16(9, false);
    const blockSize = view.getUint16(11, false);
    const origSize = view.getUint32(13, false);
    const compSize = view.getUint32(17, false);
    if (k === 0 || blockSize === 0) return null;

    const sha256 = bytes.slice(21, 53);

    let pos = 53;
    const nameLen = view.getUint16(pos, false);
    pos += 2;
    if (pos + nameLen + 2 > payloadEnd) return null;
    const fileName = decoder.decode(bytes.subarray(pos, pos + nameLen));
    pos += nameLen;

    const mimeLen = view.getUint16(pos, false);
    pos += 2;
    if (pos + mimeLen !== payloadEnd) return null;
    const mimeType = decoder.decode(bytes.subarray(pos, pos + mimeLen));

    return {
      kind: 'manifest',
      manifest: {
        sessionId,
        mode,
        compressed,
        compressionFormat,
        k,
        blockSize,
        origSize,
        compSize,
        sha256,
        fileName,
        mimeType,
      },
    };
  }

  if (type === 0x01) {
    const seqOrIndex = view.getUint32(8, false);
    const payload = bytes.slice(12, payloadEnd);
    return {
      kind: 'data',
      sessionId,
      seqOrIndex,
      payload,
    };
  }

  return null;
}
