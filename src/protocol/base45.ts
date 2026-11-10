// RFC 9285 Base45 encoding/decoding — optimal for QR Alphanumeric mode (5.5 bits/char).

export const BASE45_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const DECODE_TABLE = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE45_ALPHABET.length; i++) {
  DECODE_TABLE[BASE45_ALPHABET.charCodeAt(i)] = i;
}

export function encodeBase45(bytes: Uint8Array): string {
  const len = bytes.length;
  const out: string[] = [];

  for (let i = 0; i < len; i += 2) {
    if (i + 1 < len) {
      const x = (bytes[i] << 8) | bytes[i + 1];
      const c = x % 45;
      const d = ((x - c) / 45) % 45;
      const e = (((x - c) / 45 - d) / 45) | 0;
      out.push(BASE45_ALPHABET[c], BASE45_ALPHABET[d], BASE45_ALPHABET[e]);
    } else {
      const x = bytes[i];
      const c = x % 45;
      const d = ((x - c) / 45) | 0;
      out.push(BASE45_ALPHABET[c], BASE45_ALPHABET[d]);
    }
  }

  return out.join('');
}

export function decodeBase45(input: string): Uint8Array | null {
  const len = input.length;
  if (len === 0 || len % 3 === 1) {
    return null;
  }

  const outLen = Math.floor(len / 3) * 2 + (len % 3 === 2 ? 1 : 0);
  const out = new Uint8Array(outLen);
  let outPos = 0;

  for (let i = 0; i < len; i += 3) {
    const c0 = input.charCodeAt(i);
    const c1 = input.charCodeAt(i + 1);
    if (c0 >= 128 || c1 >= 128) return null;

    const v0 = DECODE_TABLE[c0];
    const v1 = DECODE_TABLE[c1];
    if (v0 < 0 || v1 < 0) return null;

    if (i + 2 < len) {
      const c2 = input.charCodeAt(i + 2);
      if (c2 >= 128) return null;
      const v2 = DECODE_TABLE[c2];
      if (v2 < 0) return null;

      const x = v0 + v1 * 45 + v2 * 2025;
      if (x > 0xffff) return null;

      out[outPos++] = (x >> 8) & 0xff;
      out[outPos++] = x & 0xff;
    } else {
      const x = v0 + v1 * 45;
      if (x > 0xff) return null;
      out[outPos++] = x;
    }
  }

  return out;
}
