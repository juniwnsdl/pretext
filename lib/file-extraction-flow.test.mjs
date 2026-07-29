import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';

import {
  extractDocxPreferLocal,
  extractTextViaMiso,
} from './miso-file-extractor.ts';
import { extractDocxDocument } from './docx-extractor.ts';

function response(ok, body) {
  return {
    ok,
    async json() {
      return body;
    },
  };
}

function extracted(method, text, warnings = []) {
  return {
    version: 1,
    fileName: 'contract.docx',
    sourceFormat: 'docx',
    extractionMethod: method,
    blocks: [{
      id: 'block-1',
      kind: 'raw-text',
      order: 0,
      headingPath: [],
      text,
    }],
    warnings,
  };
}

test('performs the existing upload and workflow requests and returns a raw MISO document', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/miso/upload') {
      return response(true, { success: true, fileId: 'file-7', fileName: 'policy.pdf' });
    }
    return response(true, { success: true, data: { result: '  Extracted policy text  ' } });
  };
  const file = new File(['pdf'], 'policy.pdf', { type: 'application/pdf' });

  const document = await extractTextViaMiso(file, fetchImpl);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/miso/upload');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body.get('file'), file);
  assert.equal(calls[1].url, '/api/miso');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    fileId: 'file-7',
    fileName: 'policy.pdf',
  });
  assert.equal(document.extractionMethod, 'miso');
  assert.equal(document.sourceFormat, 'pdf');
  assert.equal(document.blocks[0].kind, 'raw-text');
  assert.equal(document.blocks[0].text, '  Extracted policy text  ');
});

test('preserves upload and workflow API errors and rejects empty workflow text', async () => {
  await assert.rejects(
    extractTextViaMiso(
      new File(['x'], 'x.pdf'),
      async () => response(false, { error: 'Upload API detail' }),
    ),
    { message: 'Upload API detail' },
  );

  let call = 0;
  await assert.rejects(
    extractTextViaMiso(
      new File(['x'], 'x.pdf'),
      async () => {
        call += 1;
        return call === 1
          ? response(true, { fileId: 'f', fileName: 'x.pdf' })
          : response(false, { error: 'Workflow API detail' });
      },
    ),
    { message: 'Workflow API detail' },
  );

  call = 0;
  await assert.rejects(
    extractTextViaMiso(
      new File(['x'], 'x.pdf'),
      async () => {
        call += 1;
        return call === 1
          ? response(true, { fileId: 'f', fileName: 'x.pdf' })
          : response(true, { data: { result: '   ' } });
      },
    ),
    /empty|result|text/i,
  );
});

test('returns local DOCX extraction without calling MISO', async () => {
  const file = new File(['docx'], 'contract.docx');
  let misoCalls = 0;

  const document = await extractDocxPreferLocal(file, {
    local: async () => extracted('local-docx', 'Local structure'),
    miso: async () => {
      misoCalls += 1;
      return extracted('miso', 'Remote text');
    },
  });

  assert.equal(document.extractionMethod, 'local-docx');
  assert.equal(misoCalls, 0);
});

test('falls back to MISO exactly once and adds one warning with the local error', async () => {
  const file = new File(['docx'], 'contract.docx');
  let misoCalls = 0;

  const document = await extractDocxPreferLocal(file, {
    local: async () => {
      throw new Error('Local parser rejected package');
    },
    miso: async () => {
      misoCalls += 1;
      return extracted('miso', 'Remote text', [{
        code: 'REMOTE_NOTICE',
        severity: 'warning',
        message: 'Remote notice',
      }]);
    },
  });

  assert.equal(misoCalls, 1);
  assert.deepEqual(document.warnings.map((warning) => warning.code), [
    'REMOTE_NOTICE', 'DOCX_FALLBACK',
  ]);
  const fallbackWarnings = document.warnings.filter((warning) => warning.code === 'DOCX_FALLBACK');
  assert.equal(fallbackWarnings.length, 1);
  assert.match(fallbackWarnings[0].message, /Local parser rejected package/);
});

test('a local parser diagnostic invokes MISO fallback exactly once', async () => {
  const file = new File(['docx'], 'contract.docx');
  let misoCalls = 0;

  const document = await extractDocxPreferLocal(file, {
    local: (buffer, fileName) => extractDocxDocument(buffer, fileName, async () => ({
      value: '<p>Unknown &bogus; entity</p>',
      messages: [],
    })),
    miso: async () => {
      misoCalls += 1;
      return extracted('miso', 'Recovered remotely');
    },
  });

  assert.equal(misoCalls, 1);
  assert.equal(document.extractionMethod, 'miso');
  assert.equal(document.warnings.filter((warning) => warning.code === 'DOCX_FALLBACK').length, 1);
  assert.match(
    document.warnings.find((warning) => warning.code === 'DOCX_FALLBACK').message,
    /parse|parser|entity|error/i,
  );
});

test('rethrows the MISO failure with local failure detail attached when both paths fail', async () => {
  const localError = new Error('DOCX archive corrupt');
  const misoError = new Error('MISO unavailable');

  await assert.rejects(
    extractDocxPreferLocal(new File(['docx'], 'contract.docx'), {
      local: async () => {
        throw localError;
      },
      miso: async () => {
        throw misoError;
      },
    }),
    (error) => {
      assert.equal(error, misoError);
      assert.equal(error.message, 'MISO unavailable');
      assert.equal(error.localError, 'DOCX archive corrupt');
      assert.equal(error.cause, localError);
      return true;
    },
  );
});
