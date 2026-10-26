import { ValidationError } from '../errors';
import type { HttpClient } from '../http/HttpClient';
import { buildMultipart } from '../http/multipart';
import type { ClaimDocument, UploadOptions, UploadSource } from '../types';
import { isPresent } from '../validation/checks';
import { resolveUploadSource } from './uploadSource';

/** Upload and list the documents attached to a claim. */
export class DocumentsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Uploads a PDF, JPEG or PNG (max 10 MB) to a claim.
   *
   * @param source a file path, a Buffer (`filename` required) or a readable stream (`filename` and `size` required).
   *   Paths and Buffers are retried on transient failures; streams are not, because they can only be read once.
   */
  async upload(claimId: string, source: UploadSource, options: UploadOptions): Promise<ClaimDocument> {
    const claimIdFields: Record<string, string> = isPresent(claimId) ? {} : { claimId: 'required' };
    let resolved;
    try {
      resolved = await resolveUploadSource(source, options);
    } catch (error) {
      if (error instanceof ValidationError) throw new ValidationError({ ...claimIdFields, ...error.fields });
      throw error;
    }
    if (!isPresent(claimId)) throw new ValidationError(claimIdFields);

    const { onProgress } = options;
    let lastPercent = -1;
    const report = (percent: number) => {
      if (onProgress && percent > lastPercent) {
        lastPercent = percent;
        onProgress(percent);
      }
    };

    const document = await this.http.request<ClaimDocument>({
      method: 'POST',
      path: `/claims/${encodeURIComponent(claimId)}/documents`,
      multipart: buildMultipart({ type: options.type }, resolved.file, resolved.replayable),
      ...(onProgress ? { onUploadProgress: (sent: number, total: number) => report(Math.floor((sent / total) * 100)) } : {}),
    });
    report(100);
    return document;
  }

  /** Lists the documents uploaded to a claim. */
  async list(claimId: string): Promise<ClaimDocument[]> {
    if (!isPresent(claimId)) throw new ValidationError({ claimId: 'required' });
    return this.http.request<ClaimDocument[]>({ method: 'GET', path: `/claims/${encodeURIComponent(claimId)}/documents` });
  }
}
