import { buildRobustSolitonCdf, sampleBlockIndices } from './prng';

export type BlockState = 'missing' | 'partial' | 'solved';

interface Equation {
  id: number;
  indices: Set<number>;
  data: Uint8Array;
}

export interface PacketIngestResult {
  accepted: boolean;
  duplicate: boolean;
  newlySolved: number;
  solvedCount: number;
  totalBlocks: number;
  complete: boolean;
  activeEquations: number;
}

function xorInto(target: Uint8Array, source: Uint8Array): void {
  // Process 4 bytes at a time when aligned, or clean byte loop (fast in V8 JIT)
  const len = target.length;
  for (let i = 0; i < len; i++) {
    target[i] ^= source[i];
  }
}

function hasBit(bits: Uint32Array, col: number): boolean {
  return ((bits[col >>> 5] >>> (col & 31)) & 1) !== 0;
}

function setBit(bits: Uint32Array, col: number): void {
  bits[col >>> 5] |= 1 << (col & 31);
}

function findFirstBit(bits: Uint32Array): number {
  for (let w = 0; w < bits.length; w++) {
    const word = bits[w];
    if (word !== 0) {
      // Count trailing zeros via 32-bit de Bruijn / ctz32
      return (w << 5) + (31 - Math.clz32(word & -word));
    }
  }
  return -1;
}

function countBits(bits: Uint32Array): number {
  let count = 0;
  for (let w = 0; w < bits.length; w++) {
    let v = bits[w];
    while (v !== 0) {
      v &= v - 1;
      count++;
    }
  }
  return count;
}

export class LtEncoder {
  readonly sessionId: number;
  readonly k: number;
  readonly blockSize: number;
  private readonly blocks: Uint8Array[];
  private readonly cdf: Float64Array;

  constructor(sessionId: number, payload: Uint8Array, blockSize: number) {
    this.sessionId = sessionId >>> 0;
    this.blockSize = blockSize;
    this.k = Math.max(1, Math.ceil(payload.length / blockSize));
    this.cdf = buildRobustSolitonCdf(this.k);
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

  encodeDroplet(seed: number): { seed: number; indices: number[]; payload: Uint8Array } {
    const indices = sampleBlockIndices(this.sessionId, this.k, seed, this.cdf);
    const payload = new Uint8Array(this.blockSize);
    for (let i = 0; i < indices.length; i++) {
      xorInto(payload, this.blocks[indices[i]]);
    }
    return { seed, indices, payload };
  }
}

export class LtDecoder {
  readonly sessionId: number;
  readonly k: number;
  readonly blockSize: number;

  private readonly cdf: Float64Array;
  private readonly solved: (Uint8Array | null)[];
  private solvedCount = 0;
  private readonly seenSeeds = new Set<number>();
  private readonly equations = new Map<number, Equation>();
  private readonly blockToEqs = new Map<number, Set<number>>();
  private nextEqId = 1;
  private lastGaussAttemptEqCount = 0;

  constructor(sessionId: number, k: number, blockSize: number) {
    this.sessionId = sessionId >>> 0;
    this.k = k;
    this.blockSize = blockSize;
    this.cdf = buildRobustSolitonCdf(k);
    this.solved = new Array<Uint8Array | null>(k).fill(null);
  }

  ingestPacket(seed: number, rawPayload: Uint8Array): PacketIngestResult {
    if (rawPayload.length !== this.blockSize) {
      return {
        accepted: false,
        duplicate: false,
        newlySolved: 0,
        solvedCount: this.solvedCount,
        totalBlocks: this.k,
        complete: this.solvedCount === this.k,
        activeEquations: this.equations.size,
      };
    }

    if (this.seenSeeds.has(seed)) {
      return {
        accepted: false,
        duplicate: true,
        newlySolved: 0,
        solvedCount: this.solvedCount,
        totalBlocks: this.k,
        complete: this.solvedCount === this.k,
        activeEquations: this.equations.size,
      };
    }
    this.seenSeeds.add(seed);

    if (this.solvedCount === this.k) {
      return {
        accepted: true,
        duplicate: false,
        newlySolved: 0,
        solvedCount: this.solvedCount,
        totalBlocks: this.k,
        complete: true,
        activeEquations: 0,
      };
    }

    const beforeSolved = this.solvedCount;
    const indices = sampleBlockIndices(this.sessionId, this.k, seed, this.cdf);
    const data = new Uint8Array(rawPayload);
    const remaining = new Set<number>();

    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const existing = this.solved[idx];
      if (existing !== null) {
        xorInto(data, existing);
      } else {
        remaining.add(idx);
      }
    }

    if (remaining.size === 1) {
      const onlyIdx = remaining.values().next().value as number;
      this.markSolvedAndPeel(onlyIdx, data);
    } else if (remaining.size > 1) {
      const id = this.nextEqId++;
      const eq: Equation = { id, indices: remaining, data };
      this.equations.set(id, eq);
      for (const idx of remaining) {
        let bucket = this.blockToEqs.get(idx);
        if (!bucket) {
          bucket = new Set<number>();
          this.blockToEqs.set(idx, bucket);
        }
        bucket.add(id);
      }
      this.tryGaussianElimination();
    }

    return {
      accepted: true,
      duplicate: false,
      newlySolved: this.solvedCount - beforeSolved,
      solvedCount: this.solvedCount,
      totalBlocks: this.k,
      complete: this.solvedCount === this.k,
      activeEquations: this.equations.size,
    };
  }

  private markSolvedAndPeel(startIdx: number, startData: Uint8Array): void {
    const queue: Array<{ idx: number; data: Uint8Array }> = [{ idx: startIdx, data: startData }];

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (this.solved[item.idx] !== null) continue;

      this.solved[item.idx] = item.data;
      this.solvedCount++;

      const relatedIds = this.blockToEqs.get(item.idx);
      if (!relatedIds) continue;

      // Copy IDs because we mutate equations during peeling
      const ids = Array.from(relatedIds);
      this.blockToEqs.delete(item.idx);

      for (let i = 0; i < ids.length; i++) {
        const eqId = ids[i];
        const eq = this.equations.get(eqId);
        if (!eq || !eq.indices.has(item.idx)) continue;

        xorInto(eq.data, item.data);
        eq.indices.delete(item.idx);

        if (eq.indices.size === 1) {
          const nextIdx = eq.indices.values().next().value as number;
          this.removeEquation(eqId);
          if (this.solved[nextIdx] === null) {
            queue.push({ idx: nextIdx, data: eq.data });
          }
        } else if (eq.indices.size === 0) {
          this.removeEquation(eqId);
        }
      }
    }
  }

  private removeEquation(eqId: number): void {
    const eq = this.equations.get(eqId);
    if (!eq) return;
    for (const idx of eq.indices) {
      const bucket = this.blockToEqs.get(idx);
      if (bucket) {
        bucket.delete(eqId);
        if (bucket.size === 0) {
          this.blockToEqs.delete(idx);
        }
      }
    }
    this.equations.delete(eqId);
  }

  /**
   * Compact GF(2) RREF solver over the currently unsolved blocks so peeling never stalls
   * on small cycles (e.g., stuck at 95%+).
   */
  private tryGaussianElimination(): void {
    const remainingCount = this.k - this.solvedCount;
    if (remainingCount <= 0 || remainingCount > 512) return;
    if (this.equations.size < remainingCount) return;
    if (this.equations.size === this.lastGaussAttemptEqCount) return;
    this.lastGaussAttemptEqCount = this.equations.size;

    const unsolved: number[] = [];
    const globalToLocal = new Map<number, number>();
    for (let i = 0; i < this.k; i++) {
      if (this.solved[i] === null) {
        globalToLocal.set(i, unsolved.length);
        unsolved.push(i);
      }
    }

    const u = unsolved.length;
    const words = Math.ceil(u / 32);
    const pivots = new Map<number, { bits: Uint32Array; data: Uint8Array }>();

    for (const eq of this.equations.values()) {
      const bits = new Uint32Array(words);
      for (const gIdx of eq.indices) {
        const lIdx = globalToLocal.get(gIdx);
        if (lIdx !== undefined) {
          setBit(bits, lIdx);
        }
      }
      const data = new Uint8Array(eq.data);

      // Step 1: Eliminate all existing pivot columns from candidate row
      for (const [q, piv] of pivots) {
        if (hasBit(bits, q)) {
          for (let w = 0; w < words; w++) bits[w] ^= piv.bits[w];
          xorInto(data, piv.data);
        }
      }

      const p = findFirstBit(bits);
      if (p < 0) continue;

      // Step 2: Eliminate new pivot column `p` from all existing pivots
      for (const piv of pivots.values()) {
        if (hasBit(piv.bits, p)) {
          for (let w = 0; w < words; w++) piv.bits[w] ^= bits[w];
          xorInto(piv.data, data);
        }
      }

      pivots.set(p, { bits, data });
      if (pivots.size === u) break;
    }

    const solvedNow: Array<{ idx: number; data: Uint8Array }> = [];
    for (const [col, piv] of pivots) {
      if (countBits(piv.bits) === 1) {
        solvedNow.push({ idx: unsolved[col], data: piv.data });
      }
    }

    for (const item of solvedNow) {
      this.markSolvedAndPeel(item.idx, item.data);
    }
  }

  isComplete(): boolean {
    return this.solvedCount === this.k;
  }

  getSolvedCount(): number {
    return this.solvedCount;
  }

  getActiveEquationCount(): number {
    return this.equations.size;
  }

  getUniquePacketsCount(): number {
    return this.seenSeeds.size;
  }

  getBlockStates(): BlockState[] {
    const states = new Array<BlockState>(this.k);
    for (let i = 0; i < this.k; i++) {
      if (this.solved[i] !== null) {
        states[i] = 'solved';
      } else if ((this.blockToEqs.get(i)?.size ?? 0) > 0) {
        states[i] = 'partial';
      } else {
        states[i] = 'missing';
      }
    }
    return states;
  }

  reconstruct(compSize: number): Uint8Array | null {
    if (!this.isComplete()) return null;
    const total = this.k * this.blockSize;
    const joined = new Uint8Array(total);
    for (let i = 0; i < this.k; i++) {
      const block = this.solved[i];
      if (!block) return null;
      joined.set(block, i * this.blockSize);
    }
    return joined.subarray(0, compSize);
  }
}
