import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTemporaryPdfPath,
  parsePdfUploadRequest,
  storageResumableEndpoint,
} from './pdf-upload-contract.ts';

test('accepts a PDF upload request at the 50MB boundary', () => {
  assert.deepEqual(
    parsePdfUploadRequest({
      fileName: '현장 점검표.PDF',
      fileSize: 50 * 1024 * 1024,
      mimeType: 'application/pdf',
    }),
    {
      fileName: '현장 점검표.PDF',
      fileSize: 50 * 1024 * 1024,
      mimeType: 'application/pdf',
    },
  );
});

test('rejects non-PDF and oversized upload requests', () => {
  assert.throws(
    () => parsePdfUploadRequest({
      fileName: '현장 점검표.docx',
      fileSize: 1024,
      mimeType: 'application/pdf',
    }),
    /PDF/i,
  );
  assert.throws(
    () => parsePdfUploadRequest({
      fileName: '현장 점검표.pdf',
      fileSize: 50 * 1024 * 1024 + 1,
      mimeType: 'application/pdf',
    }),
    /50MB/i,
  );
});

test('creates a dated random PDF path without exposing the original file name', () => {
  const path = createTemporaryPdfPath(
    new Date('2026-08-14T01:02:03.000Z'),
    () => '123e4567-e89b-12d3-a456-426614174000',
  );

  assert.equal(
    path,
    'pending/2026-08-14/123e4567-e89b-12d3-a456-426614174000.pdf',
  );
  assert.equal(path.includes('현장'), false);
});

test('uses the direct Supabase Storage hostname for resumable uploads', () => {
  assert.equal(
    storageResumableEndpoint('https://project-ref.supabase.co'),
    'https://project-ref.storage.supabase.co/storage/v1/upload/resumable/sign',
  );
  assert.throws(
    () => storageResumableEndpoint('https://example.com'),
    /Supabase/i,
  );
});
