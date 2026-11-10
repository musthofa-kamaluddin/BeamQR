import { compressPayload, decompressPayload } from './compress';
import { CyclicDecoder, CyclicEncoder } from './cyclicCodec';
import { LtDecoder, LtEncoder, type BlockState } from './ltCodec';
import {
  decodePacket,
  encodeDataPacket,
  encodeManifestPacket,
  formatPacketQrString,
  type DataPacket,
  type TransferManifest,
  type TransferMode,
} from './packet';
import { bytesEqual, sha256, toHex } from './sha256';

export interface GeneratedQrSlot {
  qrText: string;
  isManifest: boolean;
  seqOrIndex: number;
  indices: number[];
}

export interface PreparedBroadcast {
  manifest: TransferManifest;
  manifestQr: string;
  generateFrameQr: (frameIndex: number) => GeneratedQrSlot;
  generateBatchQr: (frameIndex: number, slotCount: number) => GeneratedQrSlot[];
}

export async function prepareBroadcast(params: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  blockSize: number;
  mode: TransferMode;
  enableCompression: boolean;
  manifestEveryN?: number;
}): Promise<PreparedBroadcast> {
  const {
    bytes,
    fileName,
    mimeType,
    blockSize,
    mode,
    enableCompression,
    manifestEveryN = 7,
  } = params;

  const hash = await sha256(bytes);
  const {
    data: payload,
    compressed,
    format: compressionFormat,
  } = enableCompression
    ? await compressPayload(bytes)
    : { data: bytes, compressed: false, format: 'none' as const };

  const sessionId = cryptoRandomUint32();
  const k = Math.max(1, Math.ceil(payload.length / blockSize));

  const manifest: TransferManifest = {
    sessionId,
    mode,
    compressed,
    compressionFormat,
    k,
    blockSize,
    origSize: bytes.length,
    compSize: payload.length,
    sha256: hash,
    fileName,
    mimeType: mimeType || 'application/octet-stream',
  };

  const manifestQr = formatPacketQrString(encodeManifestPacket(manifest));
  const ltEncoder = mode === 'lt' ? new LtEncoder(sessionId, payload, blockSize) : null;
  const cyclicEncoder = mode === 'cyclic' ? new CyclicEncoder(sessionId, payload, blockSize) : null;

  let dataSeq = 0;

  const nextDataSlot = (): GeneratedQrSlot => {
    const seq = dataSeq++;
    if (ltEncoder) {
      const droplet = ltEncoder.encodeDroplet(seq);
      const qrText = formatPacketQrString(
        encodeDataPacket(sessionId, droplet.seed, droplet.payload),
      );
      return {
        qrText,
        isManifest: false,
        seqOrIndex: droplet.seed,
        indices: droplet.indices,
      };
    }

    const cyclicFrame = cyclicEncoder!.encodeFrame(seq);
    const qrText = formatPacketQrString(
      encodeDataPacket(sessionId, cyclicFrame.index, cyclicFrame.payload),
    );
    return {
      qrText,
      isManifest: false,
      seqOrIndex: cyclicFrame.index,
      indices: [cyclicFrame.index],
    };
  };

  const manifestSlot = (): GeneratedQrSlot => ({
    qrText: manifestQr,
    isManifest: true,
    seqOrIndex: -1,
    indices: [],
  });

  const generateFrameQr = (frameIndex: number): GeneratedQrSlot => {
    if (frameIndex === 0 || frameIndex % manifestEveryN === 0) {
      return manifestSlot();
    }
    return nextDataSlot();
  };

  const generateBatchQr = (frameIndex: number, slotCount: number): GeneratedQrSlot[] => {
    const count = Math.max(1, slotCount);
    if (count === 1) {
      return [generateFrameQr(frameIndex)];
    }

    const slots: GeneratedQrSlot[] = [];
    // Include Manifest in slot 0 at frame 0 and periodically, while all other slots carry data
    const includeManifest = frameIndex === 0 || frameIndex % Math.max(4, Math.min(6, manifestEveryN)) === 0;
    for (let s = 0; s < count; s++) {
      if (s === 0 && includeManifest) {
        slots.push(manifestSlot());
      } else {
        slots.push(nextDataSlot());
      }
    }
    return slots;
  };

  return {
    manifest,
    manifestQr,
    generateFrameQr,
    generateBatchQr,
  };
}

function cryptoRandomUint32(): number {
  if (globalThis.crypto?.getRandomValues) {
    const arr = new Uint32Array(1);
    globalThis.crypto.getRandomValues(arr);
    return arr[0] >>> 0;
  }
  return (Math.random() * 0x100000000) >>> 0;
}

export type ReceiveStatus =
  | 'listening'
  | 'receiving'
  | 'verifying'
  | 'completed'
  | 'checksum_error';

export interface ReceiveSnapshot {
  status: ReceiveStatus;
  manifest: TransferManifest | null;
  solvedBlocks: number;
  totalBlocks: number;
  activeEquations: number;
  uniquePackets: number;
  totalScans: number;
  duplicateScans: number;
  invalidScans: number;
  bufferedPreManifest: number;
  blockStates: BlockState[];
  recoveredBytes: Uint8Array | null;
  verifiedSha256Hex: string | null;
  errorMessage: string | null;
}

export class ReceiveSession {
  private manifest: TransferManifest | null = null;
  private decoder: LtDecoder | CyclicDecoder | null = null;
  private readonly preManifestBuffer = new Map<number, DataPacket[]>();

  private status: ReceiveStatus = 'listening';
  private totalScans = 0;
  private duplicateScans = 0;
  private invalidScans = 0;
  private recoveredBytes: Uint8Array | null = null;
  private verifiedSha256Hex: string | null = null;
  private errorMessage: string | null = null;
  private finalizing = false;

  reset(): void {
    this.manifest = null;
    this.decoder = null;
    this.preManifestBuffer.clear();
    this.status = 'listening';
    this.totalScans = 0;
    this.duplicateScans = 0;
    this.invalidScans = 0;
    this.recoveredBytes = null;
    this.verifiedSha256Hex = null;
    this.errorMessage = null;
    this.finalizing = false;
  }

  async ingestBatch(rawTexts: string[]): Promise<{ changed: boolean; snapshot: ReceiveSnapshot }> {
    let anyChanged = false;
    for (let i = 0; i < rawTexts.length; i++) {
      const res = await this.ingestQrText(rawTexts[i]);
      if (res.changed) anyChanged = true;
      if (this.status === 'completed' || this.status === 'checksum_error') {
        break;
      }
    }
    return { changed: anyChanged, snapshot: this.getSnapshot() };
  }

  async ingestQrText(rawText: string): Promise<{ changed: boolean; snapshot: ReceiveSnapshot }> {
    if (this.status === 'completed' || this.finalizing) {
      return { changed: false, snapshot: this.getSnapshot() };
    }

    const packet = decodePacket(rawText.trim());
    if (!packet) {
      this.invalidScans++;
      return { changed: true, snapshot: this.getSnapshot() };
    }

    this.totalScans++;

    if (packet.kind === 'manifest') {
      const m = packet.manifest;
      if (this.manifest && this.manifest.sessionId === m.sessionId) {
        this.duplicateScans++;
        return { changed: true, snapshot: this.getSnapshot() };
      }

      this.manifest = m;
      this.decoder =
        m.mode === 'lt'
          ? new LtDecoder(m.sessionId, m.k, m.blockSize)
          : new CyclicDecoder(m.sessionId, m.k, m.blockSize);
      this.status = 'receiving';
      this.recoveredBytes = null;
      this.verifiedSha256Hex = null;
      this.errorMessage = null;

      const buffered = this.preManifestBuffer.get(m.sessionId);
      if (buffered && buffered.length > 0) {
        for (const pkt of buffered) {
          this.decoder.ingestPacket(pkt.seqOrIndex, pkt.payload);
        }
      }
      this.preManifestBuffer.clear();

      if (this.decoder.isComplete()) {
        await this.finalize();
      }
      return { changed: true, snapshot: this.getSnapshot() };
    }

    if (!this.manifest || !this.decoder) {
      let bucket = this.preManifestBuffer.get(packet.sessionId);
      if (!bucket) {
        bucket = [];
        this.preManifestBuffer.set(packet.sessionId, bucket);
      }
      if (!bucket.some((p) => p.seqOrIndex === packet.seqOrIndex)) {
        bucket.push(packet);
      } else {
        this.duplicateScans++;
      }
      return { changed: true, snapshot: this.getSnapshot() };
    }

    if (packet.sessionId !== this.manifest.sessionId) {
      this.invalidScans++;
      return { changed: true, snapshot: this.getSnapshot() };
    }

    const res = this.decoder.ingestPacket(packet.seqOrIndex, packet.payload);
    if (res.duplicate) {
      this.duplicateScans++;
    } else if (!res.accepted) {
      this.invalidScans++;
    }

    if (res.complete) {
      await this.finalize();
    }

    return { changed: true, snapshot: this.getSnapshot() };
  }

  private async finalize(): Promise<void> {
    if (!this.manifest || !this.decoder || this.finalizing) return;
    this.finalizing = true;
    this.status = 'verifying';

    try {
      const compBytes = this.decoder.reconstruct(this.manifest.compSize);
      if (!compBytes) {
        throw new Error('Gagal menyusun blok data.');
      }

      const rawBytes = await decompressPayload(
        compBytes,
        this.manifest.compressed,
        this.manifest.compressionFormat,
      );
      const actualHash = await sha256(rawBytes);

      if (!bytesEqual(actualHash, this.manifest.sha256)) {
        this.status = 'checksum_error';
        this.verifiedSha256Hex = toHex(actualHash);
        this.errorMessage = 'Hash SHA-256 tidak cocok dengan manifest pengirim.';
        return;
      }

      this.recoveredBytes = rawBytes;
      this.verifiedSha256Hex = toHex(actualHash);
      this.status = 'completed';
    } catch (err) {
      this.status = 'checksum_error';
      this.errorMessage = err instanceof Error ? err.message : 'Gagal memverifikasi file.';
    } finally {
      this.finalizing = false;
    }
  }

  getSnapshot(): ReceiveSnapshot {
    let bufferedCount = 0;
    for (const list of this.preManifestBuffer.values()) {
      bufferedCount += list.length;
    }

    return {
      status: this.status,
      manifest: this.manifest,
      solvedBlocks: this.decoder?.getSolvedCount() ?? 0,
      totalBlocks: this.manifest?.k ?? 0,
      activeEquations: this.decoder?.getActiveEquationCount() ?? 0,
      uniquePackets: this.decoder?.getUniquePacketsCount() ?? 0,
      totalScans: this.totalScans,
      duplicateScans: this.duplicateScans,
      invalidScans: this.invalidScans,
      bufferedPreManifest: bufferedCount,
      blockStates: this.decoder?.getBlockStates() ?? [],
      recoveredBytes: this.recoveredBytes,
      verifiedSha256Hex: this.verifiedSha256Hex,
      errorMessage: this.errorMessage,
    };
  }
}
