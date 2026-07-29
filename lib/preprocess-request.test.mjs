import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePreprocessRequest } from './preprocess-request.ts';

function structuredDocument(overrides = {}) {
  return {
    version: 1,
    fileName: 'policy.docx',
    sourceFormat: 'docx',
    extractionMethod: 'local-docx',
    blocks: [{
      id: 'paragraph-1',
      kind: 'paragraph',
      order: 0,
      headingPath: ['Scope'],
      text: 'Structured body',
    }],
    warnings: [],
    ...overrides,
  };
}

test('accepts the fixed separator and rejects a conflicting separator', () => {
  assert.equal(normalizePreprocessRequest({
    text: 'Body',
    docType: 'general',
    separator: '@@@',
  }).ok, true);

  const invalid = normalizePreprocessRequest({ text: 'Body', separator: '###' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'INVALID_SEPARATOR');
});

test('wraps legacy text but preserves a valid structured document', () => {
  const legacy = normalizePreprocessRequest({ text: 'Body', docType: 'manual' });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.value.document.blocks[0].kind, 'raw-text');
  assert.equal(legacy.value.document.blocks[0].text, 'Body');
  assert.equal(legacy.value.docType, 'manual');

  const document = structuredDocument();
  const structured = normalizePreprocessRequest({
    document,
    text: 'Legacy text must not replace structure',
    docType: 'general',
  });
  assert.equal(structured.ok, true);
  assert.equal(structured.value.document.blocks[0].kind, 'paragraph');
  assert.equal(structured.value.document.blocks[0].text, 'Structured body');
});

test('rejects malformed block shapes instead of flattening them', () => {
  const invalid = normalizePreprocessRequest({
    document: structuredDocument({
      blocks: [{
        id: 'table-1',
        kind: 'table',
        order: 0,
        headingPath: [],
        rows: [['Valid'], [42]],
      }],
    }),
  });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'INVALID_BLOCK');

  const invalidOptionalShape = normalizePreprocessRequest({
    document: structuredDocument({
      blocks: [{
        id: 'paragraph-1',
        kind: 'paragraph',
        order: 0,
        headingPath: [],
        text: 'Body',
        rows: 'not rows',
      }],
    }),
  });
  assert.equal(invalidOptionalShape.ok, false);
  assert.equal(invalidOptionalShape.error.code, 'INVALID_BLOCK');
});

test('rejects missing and empty inputs with stable errors', () => {
  const missing = normalizePreprocessRequest({ docType: 'general' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'MISSING_INPUT');

  const emptyText = normalizePreprocessRequest({ text: ' \r\n\t ' });
  assert.equal(emptyText.ok, false);
  assert.equal(emptyText.error.code, 'EMPTY_INPUT');

  const emptyDocument = normalizePreprocessRequest({
    document: structuredDocument({
      blocks: [{
        id: 'empty-1',
        kind: 'paragraph',
        order: 0,
        headingPath: [],
        text: '   ',
      }],
    }),
  });
  assert.equal(emptyDocument.ok, false);
  assert.equal(emptyDocument.error.code, 'EMPTY_INPUT');
});

test('sanitizes structured and legacy filenames without mutating the caller', () => {
  const document = structuredDocument({ fileName: '../private\\..\\\u0000 policy?.docx' });
  const structured = normalizePreprocessRequest({ document });
  assert.equal(structured.ok, true);
  assert.equal(structured.value.document.fileName, 'policy_.docx');
  assert.equal(document.fileName, '../private\\..\\\u0000 policy?.docx');

  const legacy = normalizePreprocessRequest({ text: 'Body' });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.value.document.fileName, 'document.txt');
});

test('rejects non-object request bodies and supplied invalid documents', () => {
  for (const body of [null, [], 'Body']) {
    const invalid = normalizePreprocessRequest(body);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, 'INVALID_REQUEST');
  }

  const invalidDocument = normalizePreprocessRequest({
    document: null,
    text: 'Legacy fallback must not hide a supplied invalid document',
  });
  assert.equal(invalidDocument.ok, false);
  assert.equal(invalidDocument.error.code, 'INVALID_DOCUMENT');
});
