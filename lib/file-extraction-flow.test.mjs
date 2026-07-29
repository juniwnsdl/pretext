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

function textResponse(ok, body) {
  return {
    ok,
    async text() {
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

function abortFailure() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function pendingUntilAbort(signal) {
  return new Promise((resolve, reject) => {
    if (!signal) {
      reject(new Error('AbortSignal was not forwarded.'));
      return;
    }
    if (signal.aborted) {
      reject(abortFailure());
      return;
    }
    signal.addEventListener('abort', () => reject(abortFailure()), { once: true });
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function isAbort(error) {
  assert.equal(error.name, 'AbortError');
  return true;
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

test('preserves non-JSON failures and rejects successful HTTP error envelopes', async () => {
  await assert.rejects(
    extractTextViaMiso(
      new File(['x'], 'x.pdf'),
      async () => textResponse(false, 'Upload gateway detail'),
    ),
    { message: 'Upload gateway detail' },
  );

  await assert.rejects(
    extractTextViaMiso(
      new File(['x'], 'x.pdf'),
      async () => response(true, { error: 'Upload envelope detail' }),
    ),
    { message: 'Upload envelope detail' },
  );

  await assert.rejects(
    extractTextViaMiso(
      new File(['x'], 'x.pdf'),
      async () => response(true, { success: false, message: 'Upload status detail' }),
    ),
    { message: 'Upload status detail' },
  );

  let call = 0;
  await assert.rejects(
    extractTextViaMiso(
      new File(['x'], 'x.pdf'),
      async () => {
        call += 1;
        return call === 1
          ? response(true, { fileId: 'f', fileName: 'x.pdf' })
          : response(true, { error: 'Workflow envelope detail' });
      },
    ),
    { message: 'Workflow envelope detail' },
  );
});

test('aborts before upload and during upload without issuing a workflow request', async () => {
  const file = new File(['x'], 'x.pdf');
  const beforeController = new AbortController();
  beforeController.abort();
  let beforeCalls = 0;
  await assert.rejects(
    extractTextViaMiso(file, async () => {
      beforeCalls += 1;
      throw new Error('Fetch must not run after a prior abort.');
    }, beforeController.signal),
    isAbort,
  );
  assert.equal(beforeCalls, 0);

  const duringController = new AbortController();
  const calls = [];
  const extraction = extractTextViaMiso(file, async (url, options) => {
    calls.push(url);
    return pendingUntilAbort(options.signal);
  }, duringController.signal);
  duringController.abort();
  await assert.rejects(extraction, isAbort);
  assert.deepEqual(calls, ['/api/miso/upload']);
});

test('an abort between MISO calls prevents the obsolete workflow request', async () => {
  const controller = new AbortController();
  const calls = [];
  await assert.rejects(
    extractTextViaMiso(new File(['x'], 'x.pdf'), async (url, options) => {
      calls.push({ url, signal: options.signal });
      return {
        ok: true,
        async json() {
          controller.abort();
          return { success: true, fileId: 'f', fileName: 'x.pdf' };
        },
      };
    }, controller.signal),
    isAbort,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal, controller.signal);
});

test('forwards abort to the workflow fetch after a completed upload', async () => {
  const controller = new AbortController();
  const workflowStarted = deferred();
  const calls = [];
  const extraction = extractTextViaMiso(new File(['x'], 'x.pdf'), async (url, options) => {
    calls.push({ url, signal: options.signal });
    if (url === '/api/miso/upload') {
      return response(true, { success: true, fileId: 'f', fileName: 'x.pdf' });
    }
    workflowStarted.resolve();
    return pendingUntilAbort(options.signal);
  }, controller.signal);

  await workflowStarted.promise;
  controller.abort();
  await assert.rejects(extraction, isAbort);
  assert.deepEqual(calls.map((call) => call.url), ['/api/miso/upload', '/api/miso']);
  assert.equal(calls.every((call) => call.signal === controller.signal), true);
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

test('an oversized logical DOCX table invokes MISO fallback exactly once', async () => {
  const file = new File(['docx'], 'oversized-table.docx');
  let misoCalls = 0;

  const document = await extractDocxPreferLocal(file, {
    local: (buffer, fileName) => extractDocxDocument(buffer, fileName, async () => ({
      value: '<table><tr><td colspan="10000">Hostile width</td></tr></table>',
      messages: [],
    })),
    miso: async () => {
      misoCalls += 1;
      return extracted('miso', 'Recovered oversized table remotely');
    },
  });

  assert.equal(misoCalls, 1);
  assert.equal(document.extractionMethod, 'miso');
  assert.match(
    document.warnings.find((warning) => warning.code === 'DOCX_FALLBACK').message,
    /safe logical grid limits/i,
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

test('aborting a pending local DOCX conversion settles promptly without MISO fallback', async () => {
  const controller = new AbortController();
  const local = deferred();
  let misoCalls = 0;
  const extraction = extractDocxPreferLocal(new File(['docx'], 'contract.docx'), {
    local: async () => local.promise,
    miso: async () => {
      misoCalls += 1;
      return extracted('miso', 'Obsolete fallback');
    },
  }, controller.signal);
  const settled = extraction.then(
    () => 'fulfilled',
    (error) => error.name,
  );

  controller.abort();
  const outcome = await Promise.race([
    settled,
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 25)),
  ]);
  assert.equal(outcome, 'AbortError');
  assert.equal(misoCalls, 0);

  local.resolve(extracted('local-docx', 'Late local result'));
  await Promise.resolve();
  assert.equal(misoCalls, 0);
});
