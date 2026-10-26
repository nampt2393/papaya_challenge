import type { ValidationResult } from '../types';
import { ALLOWED_CONTENT_TYPES, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from './rules';
import { checkOneOf, toResult } from './checks';

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** Maps a filename's extension to a supported content type, or `undefined`. */
export function inferContentType(filename: string): string | undefined {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return undefined;
  return EXTENSION_CONTENT_TYPES[filename.slice(dot + 1).toLowerCase()];
}

function checkSize(size: number): string | undefined {
  if (!Number.isFinite(size) || size <= 0) return 'must be greater than 0';
  if (size > MAX_DOCUMENT_BYTES) return 'must be at most 10 MB';
  return undefined;
}

/** Validates document metadata before upload. */
export function validateDocument(input: { type: unknown; contentType: string | undefined; size: number }): ValidationResult {
  return toResult({
    type: checkOneOf(input.type, DOCUMENT_TYPES),
    contentType: checkOneOf(input.contentType, ALLOWED_CONTENT_TYPES),
    size: checkSize(input.size),
  });
}
