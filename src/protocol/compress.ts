import { deflateSync, inflateSync } from 'fflate';

// Level-9 lossless deflate-raw compression (100% bit-exact reversible on receiver).

export type CompressionKind = 'none' | 'deflate' | 'deflate-raw';

async function decompressNative(
  input: Uint8Array,
  format: 'deflate' | 'deflate-raw',
): Promise<Uint8Array> {
  const stream = new DecompressionStream(format);
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
  if (input.length === 0) {
    return { data: input, compressed: false, format: 'none' };
  }

  try {
    const compressed = deflateSync(input, { level: 9, mem: 8 });
    if (compressed.length < input.length) {
      return { data: compressed, compressed: true, format: 'deflate-raw' };
    }
  } catch {
    // Fall back to raw bytes when incompressible
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

  const fmt = format ?? 'deflate';
  if (fmt === 'deflate-raw') {
    return inflateSync(input);
  }

  if ('DecompressionStream' in globalThis) {
    return decompressNative(input, fmt);
  }

  throw new Error('Browser tidak mendukung dekompresi untuk format paket ini.');
}
