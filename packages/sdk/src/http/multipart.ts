import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { ValidationError } from '../errors';

export interface MultipartFile {
  fieldName: string;
  filename: string;
  contentType: string;
  size: number;
  open(): Readable;
}

/** A streamed `multipart/form-data` body whose length is known up front (needed for progress). */
export interface MultipartBody {
  kind: 'multipart';
  boundary: string;
  contentLength: number;
  /** `false` when the file can only be read once, so the request must not be retried. */
  replayable: boolean;
  createStream(): Readable;
}

function quote(value: string): string {
  return value.replace(/"/g, '%22').replace(/\r|\n/g, ' ');
}

function sizeMismatch(declared: number, provided: string): ValidationError {
  return new ValidationError({ size: `declared ${declared} bytes, but the source provided ${provided}` });
}

/** Object-mode streams may emit strings or other values; count and send them as bytes. */
function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  throw new ValidationError({ file: 'stream must emit Buffer, Uint8Array or string chunks' });
}

/** Builds a multipart body with the text `fields` first, then the file part. */
export function buildMultipart(fields: Record<string, string>, file: MultipartFile, replayable: boolean): MultipartBody {
  const boundary = `----insurance-sdk-${randomBytes(8).toString('hex')}`;
  const textParts = Object.entries(fields)
    .map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"\r\n\r\n${value}\r\n`)
    .join('');
  const fileHeader =
    `--${boundary}\r\nContent-Disposition: form-data; name="${quote(file.fieldName)}"; filename="${quote(file.filename)}"\r\n` +
    `Content-Type: ${file.contentType}\r\n\r\n`;
  const preamble = Buffer.from(textParts + fileHeader, 'utf8');
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

  return {
    kind: 'multipart',
    boundary,
    contentLength: preamble.length + file.size + epilogue.length,
    replayable,
    createStream: () =>
      Readable.from(
        (async function* () {
          yield preamble;
          // Content-Length is fixed up front, so a source that disagrees with `size` would hang the request
          // or corrupt the connection. Abort before the closing boundary so the server stores nothing.
          let received = 0;
          for await (const chunk of file.open()) {
            const bytes = toBuffer(chunk);
            received += bytes.length;
            if (received > file.size) throw sizeMismatch(file.size, 'more');
            yield bytes;
          }
          if (received < file.size) throw sizeMismatch(file.size, String(received));
          yield epilogue;
        })(),
      ),
  };
}
