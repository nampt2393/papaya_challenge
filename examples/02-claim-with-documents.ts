/**
 * Example 2: submit a claim and upload a document with a progress bar.
 *
 *   npm run example:2 -- <filePath> [documentType]
 *   npm run example:2 -- examples/fixtures/sample-receipt.pdf medical_receipt
 */
import { existsSync } from 'node:fs';
import { DOCUMENT_TYPES, type DocumentType } from '@insurance/partner-sdk';
import { createSdk, describeClaim, reportError, sampleClaim } from './shared';

function usage(message: string): never {
  console.error(message);
  console.error('Usage: npm run example:2 -- <filePath> [documentType]');
  console.error(`  documentType: one of ${DOCUMENT_TYPES.join(', ')} (default medical_receipt)`);
  console.error('Try: npm run example:2 -- examples/fixtures/sample-receipt.pdf');
  process.exit(1);
}

const [filePath, typeArg = 'medical_receipt'] = process.argv.slice(2);
if (!filePath) usage('Missing file path.');
if (!existsSync(filePath)) usage(`File not found: ${filePath}`);
if (!(DOCUMENT_TYPES as readonly string[]).includes(typeArg)) usage(`Unknown document type: ${typeArg}`);
const type = typeArg as DocumentType;

function renderProgress(percent: number): void {
  const filled = Math.floor(percent / 10);
  process.stdout.write(`\r  [${'#'.repeat(filled)}${'-'.repeat(10 - filled)}] ${percent}%`);
  if (percent === 100) process.stdout.write('\n');
}

const sdk = createSdk();

try {
  const claim = await sdk.claims.create(sampleClaim());
  console.log(`Created: ${describeClaim(claim)}`);

  console.log(`Uploading ${filePath} as ${type}...`);
  const document = await sdk.documents.upload(claim.id, filePath, { type, onProgress: renderProgress });
  console.log(`Uploaded: ${document.id} (${document.filename}, ${document.contentType}, ${document.size} bytes)`);

  const documents = await sdk.documents.list(claim.id);
  console.log(`\nDocuments on ${claim.id}:`);
  for (const doc of documents) console.log(`  - ${doc.id} ${doc.type} ${doc.filename} (${doc.size} bytes, ${doc.uploadedAt})`);
} catch (error) {
  process.stdout.write('\n');
  reportError(error);
  process.exit(1);
}
