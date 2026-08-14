import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPdfUploadTicket,
  uploadStoredPdfToMiso,
} from './supabase-pdf-server.ts';

const storagePath = 'pending/2026-08-14/123e4567-e89b-12d3-a456-426614174000.pdf';

test('creates a signed ticket for a server-generated private PDF path', async () => {
  let signedPath;
  const storage = {
    async createSignedUploadUrl(path) {
      signedPath = path;
      return { data: { token: 'signed-upload-token' }, error: null };
    },
  };

  const ticket = await createPdfUploadTicket(
    {
      fileName: '현장 점검표.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
    },
    storage,
    'https://project-ref.supabase.co',
    new Date('2026-08-14T01:02:03.000Z'),
    () => '123e4567-e89b-12d3-a456-426614174000',
  );

  assert.equal(signedPath, storagePath);
  assert.deepEqual(ticket, {
    path: storagePath,
    token: 'signed-upload-token',
    uploadEndpoint: 'https://project-ref.storage.supabase.co/storage/v1/upload/resumable/sign',
  });
});

test('downloads the staged PDF, uploads it to MISO as a file, and deletes the temporary object', async () => {
  const removed = [];
  const storage = {
    async download(path) {
      assert.equal(path, storagePath);
      return {
        data: new Blob(['pdf-body'], { type: 'application/pdf' }),
        error: null,
      };
    },
    async remove(paths) {
      removed.push(...paths);
      return { data: [], error: null };
    },
  };

  const result = await uploadStoredPdfToMiso({
    storagePath,
    fileName: '현장 점검표.pdf',
    storage,
    misoEndpoint: 'https://miso.example',
    apiKey: 'miso-secret',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://miso.example/ext/v1/files/upload');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer miso-secret');
      const uploaded = options.body.get('file');
      assert.equal(uploaded.name, '현장 점검표.pdf');
      assert.equal(uploaded.type, 'application/pdf');
      assert.equal(await uploaded.text(), 'pdf-body');
      assert.equal(options.body.get('user'), 'rag-preprocessor');
      return new Response(JSON.stringify({ id: 'miso-file-7' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.deepEqual(result, {
    fileId: 'miso-file-7',
    fileName: '현장 점검표.pdf',
  });
  assert.deepEqual(removed, [storagePath]);
});

test('deletes the temporary PDF when the MISO upload fails', async () => {
  const removed = [];
  const storage = {
    async download() {
      return {
        data: new Blob(['pdf-body'], { type: 'application/pdf' }),
        error: null,
      };
    },
    async remove(paths) {
      removed.push(...paths);
      return { data: [], error: null };
    },
  };

  await assert.rejects(
    uploadStoredPdfToMiso({
      storagePath,
      fileName: '현장 점검표.pdf',
      storage,
      misoEndpoint: 'https://miso.example',
      apiKey: 'miso-secret',
      fetchImpl: async () => new Response('MISO unavailable', { status: 503 }),
    }),
    /MISO unavailable/,
  );
  assert.deepEqual(removed, [storagePath]);
});
