import { decodeBase45, encodeBase45 } from './base45';
import type { CompressionKind } from './compress';
import { crc16 } from './crc16';
import { crc32 } from './crc32';

export const MAGIC_0 = 0x42; // 'B' (legacy v1)
export const MAGIC_1 = 0x51; // 'Q' (legacy v1)
export const PROTOCOL_VERSION = 1;

export const TAG_V2_MANIFEST = 0xb0;
export const TAG_V2_DATA = 0xb2;

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

  // Compact v2 manifest: tag(1) + sessionId(2) + flags(1) + k(2) + blockSize(2) + origSize(4)
  // + compSize(4) + sha256(32) + nameLen(2) + nameBytes + mimeLen(2) + mimeBytes + crc32(4)
  const totalLen = 52 + nameBytes.length + mimeBytes.length + 4;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  buf[0] = TAG_V2_MANIFEST;
  view.setUint16(1, manifest.sessionId & 0xffff, false);
  const isRawDeflate = manifest.compressionFormat === 'deflate-raw';
  buf[3] =
    (manifest.compressed ? 1 : 0) |
    (manifest.mode === 'cyclic' ? 2 : 0) |
    (manifest.compressed && isRawDeflate ? 4 : 0);

  view.setUint16(4, manifest.k, false);
  view.setUint16(6, manifest.blockSize, false);
  view.setUint32(8, manifest.origSize >>> 0, false);
  view.setUint32(12, manifest.compSize >>> 0, false);
  buf.set(manifest.sha256.subarray(0, 32), 16);

  let pos = 48;
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
  // Compact v2 data frame: tag(1) + sessionId(2) + seq24(3) + payload + crc16(2) = 8 bytes total overhead
  const totalLen = 6 + payload.length + 2;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  buf[0] = TAG_V2_DATA;
  view.setUint16(1, sessionId & 0xffff, false);
  const seq = seqOrIndex >>> 0;
  buf[3] = (seq >>> 16) & 0xff;
  buf[4] = (seq >>> 8) & 0xff;
  buf[5] = seq & 0xff;
  buf.set(payload, 6);

  const checksum = crc16(buf, 6 + payload.length);
  view.setUint16(6 + payload.length, checksum, false);
  return buf;
}

export function formatPacketQrString(packetBytes: Uint8Array): string {
  return encodeBase45(packetBytes);
}

function decodeV2Packet(bytes: Uint8Array): DecodedPacket | null {
  const tag = bytes[0];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (tag === TAG_V2_MANIFEST) {
    if (bytes.length < 56) return null;
    const payloadEnd = bytes.length - 4;
    const expectedCrc = view.getUint32(payloadEnd, false);
    if (crc32(bytes, payloadEnd) !== expectedCrc) return null;

    const sessionId = view.getUint16(1, false);
    const flags = bytes[3];
    const compressed = (flags & 1) !== 0;
    const mode: TransferMode = (flags & 2) !== 0 ? 'cyclic' : 'lt';
    const compressionFormat: CompressionKind = !compressed
      ? 'none'
      : (flags & 4) !== 0
        ? 'deflate-raw'
        : 'deflate';
    const k = view.getUint16(4, false);
    const blockSize = view.getUint16(6, false);
    const origSize = view.getUint32(8, false);
    const compSize = view.getUint32(12, false);
    if (k === 0 || blockSize === 0) return null;

    const sha256 = bytes.slice(16, 48);

    let pos = 48;
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

  if (tag === TAG_V2_DATA) {
    if (bytes.length < 9) return null;
    const payloadEnd = bytes.length - 2;
    const expectedCrc = view.getUint16(payloadEnd, false);
    if (crc16(bytes, payloadEnd) !== expectedCrc) return null;

    const sessionId = view.getUint16(1, false);
    const seqOrIndex = (bytes[3] << 16) | (bytes[4] << 8) | bytes[5];
    const payload = bytes.slice(6, payloadEnd);

    return {
      kind: 'data',
      sessionId,
      seqOrIndex,
      payload,
    };
  }

  return null;
}

export function decodePacket(qrText: string): DecodedPacket | null {
  const bytes = decodeBase45(qrText);
  if (!bytes || bytes.length < 9) return null;

  if (bytes[0] === TAG_V2_MANIFEST || bytes[0] === TAG_V2_DATA) {
    return decodeV2Packet(bytes);
  }

  // Legacy v1 packet compatibility
  if (bytes.length < 16) return null;
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
