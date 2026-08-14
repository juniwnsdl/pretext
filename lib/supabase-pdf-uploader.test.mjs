import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';

import {
  requestPdfUploadTicket,
  uploadPdfWithTus,
} from './supabase-pdf-uploader.ts';

const ticket = {
  path: 'pending/2026-08-14/123e4567-e89b-12d3-a456-426614174000.pdf',
  token: 'signed-upload-token',
  uploadEndpoint: 'https://project-ref.storage.supabase.co/storage/v1/upload/resumable/sign',
};

test('requests a scoped PDF upload ticket using metadata only', async () => {
  const file = new File(['pdf-body'], '현장 점검표.pdf', {
    type: 'application/pdf',
  });
  let observed;

  const result = await requestPdfUploadTicket(file, async (url, options) => {
    observed = { url, options };
    return new Response(JSON.stringify(ticket), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  assert.equal(observed.url, '/api/miso/upload-ticket');
  assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(observed.options.body), {
    fileName: '현장 점검표.pdf',
    fileSize: 8,
    mimeType: 'application/pdf',
  });
  assert.deepEqual(result, ticket);
});

test('uploads PDF bytes directly to Supabase with the signed TUS token', async () => {
  const file = new File(['pdf-body'], '현장 점검표.pdf', {
    type: 'application/pdf',
  });
  let constructed;

  class FakeUpload {
    constructor(uploadedFile, options) {
      constructed = { uploadedFile, options };
    }

    start() {
      constructed.options.onSuccess();
    }

    async abort() {}
  }

  await uploadPdfWithTus(file, ticket, undefined, FakeUpload);

  assert.equal(constructed.uploadedFile, file);
  assert.equal(constructed.options.endpoint, ticket.uploadEndpoint);
  assert.deepEqual(constructed.options.headers, {
    'x-signature': ticket.token,
  });
  assert.deepEqual(constructed.options.metadata, {
    bucketName: 'temp-pdfs',
    objectName: ticket.path,
    contentType: 'application/pdf',
    cacheControl: '0',
  });
  assert.equal(constructed.options.chunkSize, 6 * 1024 * 1024);
  assert.deepEqual(constructed.options.retryDelays, [0, 3000, 5000, 10000, 20000]);
  assert.equal(constructed.options.removeFingerprintOnSuccess, true);
  assert.equal(constructed.options.uploadDataDuringCreation, true);
});
