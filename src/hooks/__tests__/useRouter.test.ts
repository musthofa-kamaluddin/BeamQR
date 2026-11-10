import { describe, expect, it } from 'vitest';
import { normalizeRoute } from '../useRouter';

describe('SPA route normalization', () => {
  it('maps root, send, receive, aliases, and trailing slashes cleanly', () => {
    expect(normalizeRoute('/')).toBe('/');
    expect(normalizeRoute('/send')).toBe('/send');
    expect(normalizeRoute('/send/')).toBe('/send');
    expect(normalizeRoute('/sender')).toBe('/send');
    expect(normalizeRoute('/receive')).toBe('/receive');
    expect(normalizeRoute('/receive/')).toBe('/receive');
    expect(normalizeRoute('/receiver')).toBe('/receive');
    expect(normalizeRoute('/anything-else')).toBe('/');
  });
});
