import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { ValidationError } from '../errors';
import type { MultipartFile } from '../http/multipart';
import type { UploadOptions, UploadSource } from '../types';
import { checkOneOf, isPresent } from '../validation/checks';
import { DOCUMENT_TYPES } from '../validation/rules';
import { inferContentType, validateDocument } from '../validation/validateDocument';

export interface ResolvedSource {
  file: MultipartFile;
  /** `false` for streams: they can only be read once, so the upload is never retried. */
  replayable: boolean;
}

interface SourceInfo {
  filename: string | undefined;
  size: number | undefined;
  open: () => Readable;
  replayable: boolean;
}

async function describePath(path: string, options: UploadOptions, fields: Record<string, string>): Promise<SourceInfo | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      fields.file = 'file not found';
      return undefined;
    }
    return { filename: options.filename ?? basename(path), size: info.size, open: () => createReadStream(path), replayable: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    fields.file = code === 'ENOENT' || code === 'ENOTDIR' ? 'file not found' : 'cannot be read';
    return undefined;
  }
}

/**
 * Normalises a path, Buffer or stream into a multipart file part and validates it
 * (type, content type, size). Throws `ValidationError` before anything is sent.
 */
export async function resolveUploadSource(source: UploadSource, options: UploadOptions): Promise<ResolvedSource> {
  const fields: Record<string, string> = {};
  let info: SourceInfo | undefined;

  if (typeof source === 'string') {
    info = await describePath(source, options, fields);
  } else if (Buffer.isBuffer(source)) {
    info = { filename: options.filename, size: source.length, open: () => Readable.from([source]), replayable: true };
  } else {
    info = { filename: options.filename, size: options.size, open: () => source, replayable: false };
    if (options.size === undefined) fields.size = 'required for stream uploads';
  }
  if (info && !isPresent(info.filename)) fields.filename = 'required';

  if (!info || Object.keys(fields).length > 0 || info.filename === undefined || info.size === undefined) {
    const typeError = checkOneOf(options.type, DOCUMENT_TYPES);
    throw new ValidationError(typeError === undefined ? fields : { ...fields, type: typeError });
  }

  const contentType = options.contentType ?? inferContentType(info.filename);
  const result = validateDocument({ type: options.type, contentType, size: info.size });
  if (!result.ok) throw new ValidationError(result.fields);

  return {
    file: { fieldName: 'file', filename: info.filename, contentType: contentType as string, size: info.size, open: info.open },
    replayable: info.replayable,
  };
}
