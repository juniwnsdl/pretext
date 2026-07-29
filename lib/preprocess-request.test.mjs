import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PREPROCESS_MAX_AGGREGATE_STRUCTURE_ITEMS,
  PREPROCESS_MAX_AGGREGATE_TEXT_LENGTH,
  PREPROCESS_MAX_DOCUMENT_BLOCKS,
  PREPROCESS_MAX_HEADING_PATH_DEPTH,
  PREPROCESS_MAX_ISSUE_LOCATIONS,
  PREPROCESS_MAX_TABLE_CELLS,
  PREPROCESS_MAX_TABLE_COLUMNS,
  PREPROCESS_MAX_TABLE_MERGES,
  PREPROCESS_MAX_TABLE_ROWS,
  PREPROCESS_MAX_WARNINGS,
  normalizePreprocessRequest,
} from './preprocess-request.ts';

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

function assertInputTooLarge(document) {
  const result = normalizePreprocessRequest({ document });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INPUT_TOO_LARGE');
}

test('accepts the exact practical table and collection boundaries', () => {
  const sharedCell = 'x';
  const fullRow = Array(PREPROCESS_MAX_TABLE_COLUMNS).fill(sharedCell);
  const fullRowCount = Math.floor(PREPROCESS_MAX_TABLE_CELLS / PREPROCESS_MAX_TABLE_COLUMNS);
  const remainder = PREPROCESS_MAX_TABLE_CELLS % PREPROCESS_MAX_TABLE_COLUMNS;
  const rows = [
    ...Array(fullRowCount).fill(fullRow),
    ...(remainder > 0 ? [Array(remainder).fill(sharedCell)] : []),
  ];

  assert.equal(rows.length <= PREPROCESS_MAX_TABLE_ROWS, true);
  const result = normalizePreprocessRequest({
    document: structuredDocument({
      blocks: [{
        id: 'table-boundary',
        kind: 'table',
        order: 0,
        headingPath: Array(PREPROCESS_MAX_HEADING_PATH_DEPTH).fill('Area'),
        rows,
        merges: Array(PREPROCESS_MAX_TABLE_MERGES).fill({
          range: 'A1:A1',
          start: { row: 0, column: 0 },
          end: { row: 0, column: 0 },
        }),
      }],
      warnings: Array.from({ length: PREPROCESS_MAX_WARNINGS }, (_, index) => ({
        code: 'BOUNDARY',
        severity: 'warning',
        message: `Boundary warning ${index}`,
        ...(index === 0 ? {
          locations: Array(PREPROCESS_MAX_ISSUE_LOCATIONS).fill('sheet!A1'),
        } : {}),
      })),
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.document.blocks[0].rows.length, rows.length);
});

test('rejects each named collection and table budget before cloning', () => {
  const block = structuredDocument().blocks[0];
  const merge = {
    range: 'A1:B2',
    start: { row: 0, column: 0 },
    end: { row: 1, column: 1 },
  };
  const warning = {
    code: 'LIMIT',
    severity: 'warning',
    message: 'Limit warning',
  };

  assertInputTooLarge(structuredDocument({
    blocks: Array(PREPROCESS_MAX_DOCUMENT_BLOCKS + 1).fill(block),
  }));
  assertInputTooLarge(structuredDocument({
    warnings: Array(PREPROCESS_MAX_WARNINGS + 1).fill(warning),
  }));
  assertInputTooLarge(structuredDocument({
    blocks: [{ ...block, headingPath: Array(PREPROCESS_MAX_HEADING_PATH_DEPTH + 1).fill('Area') }],
  }));
  assertInputTooLarge(structuredDocument({
    blocks: [{
      id: 'too-many-rows', kind: 'table', order: 0, headingPath: [],
      rows: Array(PREPROCESS_MAX_TABLE_ROWS + 1).fill(['x']),
    }],
  }));
  assertInputTooLarge(structuredDocument({
    blocks: [{
      id: 'too-many-columns', kind: 'table', order: 0, headingPath: [],
      rows: [Array(PREPROCESS_MAX_TABLE_COLUMNS + 1).fill('x')],
    }],
  }));
  assertInputTooLarge(structuredDocument({
    blocks: [{
      id: 'too-many-cells', kind: 'table', order: 0, headingPath: [],
      rows: Array(Math.floor(PREPROCESS_MAX_TABLE_CELLS / PREPROCESS_MAX_TABLE_COLUMNS) + 1)
        .fill(Array(PREPROCESS_MAX_TABLE_COLUMNS).fill('x')),
    }],
  }));
  assertInputTooLarge(structuredDocument({
    blocks: [{
      id: 'too-many-merges', kind: 'table', order: 0, headingPath: [], rows: [['x']],
      merges: Array(PREPROCESS_MAX_TABLE_MERGES + 1).fill(merge),
    }],
  }));
  assertInputTooLarge(structuredDocument({
    warnings: [{
      ...warning,
      locations: Array(PREPROCESS_MAX_ISSUE_LOCATIONS + 1).fill('sheet!A1'),
    }],
  }));
});

test('rejects aggregate text and structure budgets using shared fixtures', () => {
  const textHeavyCell = 'x'.repeat(
    Math.floor(PREPROCESS_MAX_AGGREGATE_TEXT_LENGTH / PREPROCESS_MAX_TABLE_CELLS) + 1,
  );
  const textHeavyFullRow = Array(PREPROCESS_MAX_TABLE_COLUMNS).fill(textHeavyCell);
  const textHeavyFullRows = Math.floor(PREPROCESS_MAX_TABLE_CELLS / PREPROCESS_MAX_TABLE_COLUMNS);
  const textHeavyRemainder = PREPROCESS_MAX_TABLE_CELLS % PREPROCESS_MAX_TABLE_COLUMNS;
  const textHeavyRows = [
    ...Array(textHeavyFullRows).fill(textHeavyFullRow),
    ...(textHeavyRemainder > 0
      ? [Array(textHeavyRemainder).fill(textHeavyCell)]
      : []),
  ];
  assertInputTooLarge(structuredDocument({
    blocks: [{
      id: 'aggregate-text', kind: 'table', order: 0, headingPath: [], rows: textHeavyRows,
    }],
  }));

  const sharedRow = Array(PREPROCESS_MAX_TABLE_COLUMNS).fill('');
  const rows = Array(Math.floor(PREPROCESS_MAX_TABLE_CELLS / PREPROCESS_MAX_TABLE_COLUMNS))
    .fill(sharedRow);
  const tableCount = Math.ceil(PREPROCESS_MAX_AGGREGATE_STRUCTURE_ITEMS / PREPROCESS_MAX_TABLE_CELLS) + 1;
  assertInputTooLarge(structuredDocument({
    blocks: Array.from({ length: tableCount }, (_, index) => ({
      id: `aggregate-structure-${index}`,
      kind: 'table',
      order: index,
      headingPath: [],
      rows,
    })),
  }));
});
