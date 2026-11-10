// Deterministic Mulberry32 PRNG and Robust Soliton Distribution for LT Codes.

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds the cumulative distribution function (CDF) for a Robust Soliton degree
 * distribution over degrees 1..k (returned array has length k + 1, cdf[0] = 0, cdf[k] = 1).
 */
export function buildRobustSolitonCdf(k: number, c = 0.2, delta = 0.05): Float64Array {
  const cdf = new Float64Array(k + 1);
  if (k <= 0) return cdf;
  if (k === 1) {
    cdf[1] = 1;
    return cdf;
  }

  const weights = new Float64Array(k + 1);

  // Ideal Soliton
  weights[1] = 1 / k;
  for (let d = 2; d <= k; d++) {
    weights[d] = 1 / (d * (d - 1));
  }

  // Robust component
  const r = c * Math.log(k / delta) * Math.sqrt(k);
  const spike = Math.max(1, Math.min(k, Math.floor(k / Math.max(r, 1e-6))));

  for (let d = 1; d < spike; d++) {
    weights[d] += r / (d * k);
  }
  weights[spike] += (r * Math.log(Math.max(r / delta, 1))) / k;

  let sum = 0;
  for (let d = 1; d <= k; d++) {
    sum += weights[d];
  }

  let acc = 0;
  for (let d = 1; d <= k; d++) {
    acc += weights[d] / sum;
    cdf[d] = acc;
  }
  cdf[k] = 1;
  return cdf;
}

function sampleDegree(cdf: Float64Array, k: number, u: number): number {
  let lo = 1;
  let hi = k;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cdf[mid] < u) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Deterministically maps (sessionId, k, seed) to the sorted list of source block
 * indices XORed into that droplet. Both sender and receiver use this exact function.
 */
export function sampleBlockIndices(
  sessionId: number,
  k: number,
  seed: number,
  cachedCdf?: Float64Array,
): number[] {
  if (k <= 0) return [];
  if (k === 1) return [0];

  // Phase 1: Systematic first sweep so clean scans decode with 0% overhead.
  if (seed < k) {
    return [seed];
  }

  // Phase 2: Periodic degree-1 anchor after the initial sweep so receivers
  // joining mid-broadcast always get fresh peeling anchors without excess overhead.
  const offset = seed - k;
  const anchorStep = k > 8 ? 8 : 4;
  if (offset % anchorStep === 0) {
    return [Math.floor(offset / anchorStep) % k];
  }

  const mixSeed = (sessionId ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0;
  const rng = mulberry32(mixSeed);
  const cdf = cachedCdf ?? buildRobustSolitonCdf(k);
  const degree = Math.min(k, Math.max(1, sampleDegree(cdf, k, rng())));

  if (degree === 1) {
    return [Math.floor(rng() * k)];
  }

  if (degree === k) {
    const all = new Array<number>(k);
    for (let i = 0; i < k; i++) all[i] = i;
    return all;
  }

  if (degree < k / 3) {
    const picked = new Set<number>();
    while (picked.size < degree) {
      picked.add(Math.floor(rng() * k));
    }
    return Array.from(picked).sort((a, b) => a - b);
  }

  // Partial Fisher-Yates for dense degrees
  const pool = new Int32Array(k);
  for (let i = 0; i < k; i++) pool[i] = i;
  const result = new Array<number>(degree);
  for (let i = 0; i < degree; i++) {
    const j = i + Math.floor(rng() * (k - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
    result[i] = pool[i];
  }
  result.sort((a, b) => a - b);
  return result;
}
