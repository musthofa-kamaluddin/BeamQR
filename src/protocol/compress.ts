// Native Web Streams deflate-raw / deflate compression with clean fallback when incompressible.

export type CompressionKind = 'none' | 'deflate' | 'deflate-raw';

async function runStream(
  input: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const writePromise = writer.write(new Uint8Array(input)).then(() => writer.close());

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }

  await writePromise;

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function compressPayload(
  input: Uint8Array,
): Promise<{ data: Uint8Array; compressed: boolean; format: CompressionKind }> {
  if (input.length === 0 || !('CompressionStream' in globalThis)) {
    return { data: input, compressed: false, format: 'none' };
  }

  // Prefer deflate-raw (saves 6 bytes of zlib header/footer)
  for (const fmt of ['deflate-raw', 'deflate'] as const) {
    try {
      const compressed = await runStream(input, new CompressionStream(fmt));
      if (compressed.length < input.length) {
        return { data: compressed, compressed: true, format: fmt };
      }
      return { data: input, compressed: false, format: 'none' };
    } catch {
      // Try next supported stream format
    }
  }

  return { data: input, compressed: false, format: 'none' };
}

export async function decompressPayload(
  input: Uint8Array,
  compressed: boolean,
  format?: CompressionKind,
): Promise<Uint8Array> {
  if (!compressed || format === 'none') {
    return input;
  }
  if (!('DecompressionStream' in globalThis)) {
    throw new Error('Browser tidak mendukung DecompressionStream untuk membaca file terkompresi.');
  }
  const fmt = format ?? 'deflate';
  return runStream(input, new DecompressionStream(fmt));
}
