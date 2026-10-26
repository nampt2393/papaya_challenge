import type { MultipartValue } from '@fastify/multipart';
import { type ClaimDocument, type DocumentType, validateDocument } from '@insurance/partner-sdk';
import type { FastifyInstance } from 'fastify';
import { claimNotFound, validationFailed } from './claims';

function fileTooLarge() {
  return { code: 'FILE_TOO_LARGE', message: 'File exceeds the 10 MB limit' };
}

export function documentRoutes(app: FastifyInstance): void {
  const { store, config } = app;

  app.post<{ Params: { id: string } }>('/api/v1/claims/:id/documents', async (request, reply) => {
    const claimId = request.params.id;
    if (!store.claims.has(claimId)) return claimNotFound(reply, claimId);
    if (!request.isMultipart()) return validationFailed(reply, { file: 'required' });

    const part = await request.file();
    if (!part) return validationFailed(reply, { file: 'required' });

    // Drain the stream: the mock keeps metadata only.
    let size = 0;
    try {
      for await (const chunk of part.file) size += (chunk as Buffer).length;
    } catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send(fileTooLarge());
      throw error;
    }
    if (part.file.truncated) return reply.code(413).send(fileTooLarge());

    const typeField = part.fields.type as MultipartValue<string> | undefined;
    const type = typeField?.value;
    const result = validateDocument({ type, contentType: part.mimetype, size });
    if (!result.ok) {
      const { contentType, ...otherFields } = result.fields;
      if (Object.keys(otherFields).length > 0) return validationFailed(reply, otherFields);
      return reply.code(415).send({ code: 'UNSUPPORTED_MEDIA_TYPE', message: `Unsupported content type: ${part.mimetype} (${contentType})` });
    }

    const document: ClaimDocument = {
      id: store.nextDocumentId(),
      claimId,
      type: type as DocumentType,
      filename: part.filename,
      contentType: part.mimetype,
      size,
      uploadedAt: new Date(config.now()).toISOString(),
    };
    store.documents.set(claimId, [...(store.documents.get(claimId) ?? []), document]);
    return reply.code(201).send(document);
  });

  app.get<{ Params: { id: string } }>('/api/v1/claims/:id/documents', async (request, reply) => {
    const claimId = request.params.id;
    if (!store.claims.has(claimId)) return claimNotFound(reply, claimId);
    return store.documents.get(claimId) ?? [];
  });
}
