import { describe, expect, it } from 'vitest';
import { decodeBase45, encodeBase45 } from '../base45';

describe('Base45 RFC 9285', () => {
  it('roundtrips standard RFC 9285 vectors and random payloads', () => {
    const encoder = new TextEncoder();
    expect(encodeBase45(encoder.encode('AB'))).toBe('BB8');
    expect(encodeBase45(encoder.encode('Hello!!'))).toBe('%69 VD92EX0');
    expect(encodeBase45(encoder.encode('base-45'))).toBe('UJCLQE7W581');

    for (const len of [1, 2, 3, 17, 64, 255, 512]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = (i * 73 + 19) & 0xff;
      }
      const encoded = encodeBase45(bytes);
      const decoded = decodeBase45(encoded);
      expect(decoded).toEqual(bytes);
    }
  });

  it('rejects malformed lengths, invalid chars, and value overflows', () => {
    expect(decodeBase45('')).toBeNull();
    expect(decodeBase45('A')).toBeNull();
    expect(decodeBase45('ABCD')).toBeNull();
    expect(decodeBase45('abc')).toBeNull();
    expect(decodeBase45(':::')).toBeNull(); // 44 + 44*45 + 44*2025 > 65535
    expect(decodeBase45('::')).toBeNull(); // 44 + 44*45 > 255
  });
});
