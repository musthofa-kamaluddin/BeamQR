import type { BlockState, PacketIngestResult } from './ltCodec';

export class CyclicEncoder {
  readonly sessionId: number;
  readonly k: number;
  readonly blockSize: number;
  private readonly blocks: Uint8Array[];

  constructor(sessionId: number, payload: Uint8Array, blockSize: number) {
    this.sessionId = sessionId >>> 0;
    this.blockSize = blockSize;
    this.k = Math.max(1, Math.ceil(payload.length / blockSize));
    this.blocks = new Array<Uint8Array>(this.k);

    for (let i = 0; i < this.k; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, payload.length);
      const block = new Uint8Array(blockSize);
      if (start < payload.length) {
        block.set(payload.subarray(start, end));
      }
      this.blocks[i] = block;
    }
  }

  encodeFrame(seq: number): { index: number; payload: Uint8Array } {
    const index = seq % this.k;
    return { index, payload: this.blocks[index] };
  }
}

export class CyclicDecoder {
  readonly sessionId: number;
  readonly k: number;
  readonly blockSize: number;

  private readonly blocks: (Uint8Array | null)[];
  private receivedCount = 0;
  private uniqueSeen = 0;

  constructor(sessionId: number, k: number, blockSize: number) {
    this.sessionId = sessionId >>> 0;
    this.k = k;
    this.blockSize = blockSize;
    this.blocks = new Array<Uint8Array | null>(k).fill(null);
  }

  ingestPacket(index: number, rawPayload: Uint8Array): PacketIngestResult {
    if (index < 0 || index >= this.k || rawPayload.length !== this.blockSize) {
      return {
        accepted: false,
        duplicate: false,
        newlySolved: 0,
        solvedCount: this.receivedCount,
        totalBlocks: this.k,
        complete: this.receivedCount === this.k,
        activeEquations: 0,
      };
    }

    if (this.blocks[index] !== null) {
      return {
        accepted: false,
        duplicate: true,
        newlySolved: 0,
        solvedCount: this.receivedCount,
        totalBlocks: this.k,
        complete: this.receivedCount === this.k,
        activeEquations: 0,
      };
    }

    this.blocks[index] = new Uint8Array(rawPayload);
    this.receivedCount++;
    this.uniqueSeen++;

    return {
      accepted: true,
      duplicate: false,
      newlySolved: 1,
      solvedCount: this.receivedCount,
      totalBlocks: this.k,
      complete: this.receivedCount === this.k,
      activeEquations: 0,
    };
  }

  isComplete(): boolean {
    return this.receivedCount === this.k;
  }

  getSolvedCount(): number {
    return this.receivedCount;
  }

  getActiveEquationCount(): number {
    return 0;
  }

  getUniquePacketsCount(): number {
    return this.uniqueSeen;
  }

  getBlockStates(): BlockState[] {
    return this.blocks.map((b) => (b ? 'solved' : 'missing'));
  }

  reconstruct(compSize: number): Uint8Array | null {
    if (!this.isComplete()) return null;
    const joined = new Uint8Array(this.k * this.blockSize);
    for (let i = 0; i < this.k; i++) {
      const b = this.blocks[i];
      if (!b) return null;
      joined.set(b, i * this.blockSize);
    }
    return joined.subarray(0, compSize);
  }
}
