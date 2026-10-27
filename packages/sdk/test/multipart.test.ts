import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors';
import { buildMultipart } from '../src/http/multipart';

function body(declaredSize: number, data: unknown[]) {
  return buildMultipart(
    { type: 'other' },
    { fieldName: 'file', filename: 'a.pdf', contentType: 'application/pdf', size: declaredSize, open: () => Readable.from(data) },
    false,
  );
}

/** Reads the body stream, returning what was emitted and the error it ended with, if any. */
async function drain(stream: Readable): Promise<{ bytes: Buffer; error: unknown }> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return { bytes: Buffer.concat(chunks), error: undefined };
  } catch (error) {
    return { bytes: Buffer.concat(chunks), error };
  }
}

describe('buildMultipart size check', () => {
  it('fails with ValidationError when the source provides fewer bytes than declared, before the closing boundary', async () => {
    const multipart = body(2000, [Buffer.alloc(1000, 1)]);
    const { bytes, error } = await drain(multipart.createStream());
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual({ size: 'declared 2000 bytes, but the source provided 1000' });
    expect(bytes.toString('latin1')).not.toContain(`--${multipart.boundary}--`);
  });

  it('fails with ValidationError when the source provides more bytes than declared, without emitting the excess', async () => {
    const multipart = body(500, [Buffer.alloc(400, 1), Buffer.alloc(400, 2)]);
    const { bytes, error } = await drain(multipart.createStream());
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual({ size: 'declared 500 bytes, but the source provided more' });
    expect(bytes.length).toBeLessThanOrEqual(multipart.contentLength);
    expect(bytes.includes(2)).toBe(false);
  });

  it('emits exactly contentLength bytes when the size matches', async () => {
    const multipart = body(1000, [Buffer.alloc(600, 1), Buffer.alloc(400, 2)]);
    const { bytes, error } = await drain(multipart.createStream());
    expect(error).toBeUndefined();
    expect(bytes.length).toBe(multipart.contentLength);
    expect(bytes.toString('latin1').endsWith(`--${multipart.boundary}--\r\n`)).toBe(true);
  });

  it('counts string chunks as UTF-8 bytes', async () => {
    const multipart = body(4, ['é', 'é']);
    const { bytes, error } = await drain(multipart.createStream());
    expect(error).toBeUndefined();
    expect(bytes.length).toBe(multipart.contentLength);
  });

  it('rejects a string stream whose UTF-8 length exceeds the declared size', async () => {
    const multipart = body(2, ['éé']);
    const { bytes, error } = await drain(multipart.createStream());
    expect((error as ValidationError).fields).toEqual({ size: 'declared 2 bytes, but the source provided more' });
    expect(bytes.length).toBeLessThan(multipart.contentLength);
  });

  it('accepts Uint8Array chunks', async () => {
    const multipart = body(3, [new Uint8Array([1, 2, 3])]);
    const { bytes, error } = await drain(multipart.createStream());
    expect(error).toBeUndefined();
    expect(bytes.length).toBe(multipart.contentLength);
  });

  it('rejects chunks that are not binary or text with ValidationError', async () => {
    const { error } = await drain(body(3, [1, 2, 3]).createStream());
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields).toEqual({ file: 'stream must emit Buffer, Uint8Array or string chunks' });
  });
});
