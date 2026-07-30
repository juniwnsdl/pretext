import test from 'node:test';
import assert from 'node:assert/strict';

import * as XLSX from 'xlsx';
import { extractWorkbookDocument } from './excel-workbook-extractor.ts';

test('extracts sheets, merges, blank rows, and displayed cell text without flattening', () => {
  const first = XLSX.utils.aoa_to_sheet([
    ['설비', '설명'],
    ['P-1', 'A|B, "인용"\n두 번째 줄'],
    [],
    ['설비', '상태'],
    ['P-2', '정상'],
  ]);
  first['!merges'] = [XLSX.utils.decode_range('A1:B1')];
  const second = XLSX.utils.aoa_to_sheet([['항목', '값'], ['압력', 10]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, first, '일일점검');
  XLSX.utils.book_append_sheet(workbook, second, '운전값');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const document = extractWorkbookDocument(bytes, '점검.xlsx');

  assert.equal(document.blocks.length, 2);
  assert.deepEqual(document.blocks.map((block) => block.sheetName), ['일일점검', '운전값']);
  assert.equal(document.blocks[0].rows[1][1], 'A|B, "인용"\n두 번째 줄');
  assert.deepEqual(document.blocks[0].rows[2], ['', '']);
  assert.equal(document.blocks[0].rows[0][1], '');
  assert.deepEqual(document.blocks[0].merges, [{
    range: 'A1:B1',
    start: { row: 0, column: 0 },
    end: { row: 0, column: 1 },
  }]);
  assert.deepEqual(
    document.warnings.find((issue) => issue.code === 'MERGED_CELLS')?.locations,
    ['일일점검!A1:B1'],
  );
});

test('uses workbook display formats for dates and numbers', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['일자', '금액'],
    [new Date(Date.UTC(2026, 6, 29)), 1234.5],
  ], { cellDates: true });
  sheet.A2.z = 'yyyy-mm-dd';
  sheet.B2.z = '#,##0.00';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '표시값');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const document = extractWorkbookDocument(bytes, '표시.xlsx');

  assert.deepEqual(document.blocks[0].rows[1], ['2026-07-29', '1,234.50']);
});

test('reads Excel print-title rows as the automatic sheet header range', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Attachment 6'],
    ['Anyang Plant'],
    ['No.', 'Description', 'Vendor Name', 'Origin', 'Remarks'],
    ['', '', '', '', ''],
    ['Item : Mechanical'],
    ['1', 'Gas Turbine', 'Vendor A', 'Korea', ''],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sub-Supplier List');
  workbook.Workbook = {
    Names: [{
      Name: '_xlnm.Print_Titles',
      Ref: "'Sub-Supplier List'!$1:$4",
      Sheet: 0,
    }],
  };
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const document = extractWorkbookDocument(bytes, 'sub-suppliers.xlsx');

  assert.deepEqual(document.blocks[0].excelLayout, {
    usedRange: { startRow: 1, endRow: 6 },
    headerRows: { startRow: 1, endRow: 4, source: 'print-titles' },
  });
});

test('detects the densest early row when a workbook has no print-title metadata', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Supplier List'],
    ['Project Alpha'],
    ['No.', 'Description', 'Vendor Name', 'Origin'],
    ['Item : Mechanical'],
    ['1', 'Pump', 'Vendor A', 'Korea'],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Suppliers');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const document = extractWorkbookDocument(bytes, 'suppliers.xlsx');

  assert.deepEqual(document.blocks[0].excelLayout, {
    usedRange: { startRow: 1, endRow: 5 },
    headerRows: { startRow: 3, endRow: 3, source: 'detected' },
  });
});

test('keeps absolute merge coordinates while clearing covered cells in an offset range', () => {
  const sheet = {
    '!ref': 'C5:D6',
    C5: { t: 's', v: '설비' },
    D5: { t: 's', v: '덮인 제목' },
    C6: { t: 's', v: 'P-5' },
    D6: { t: 's', v: '정상' },
    '!merges': [XLSX.utils.decode_range('C5:D5')],
  };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '오프셋');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const document = extractWorkbookDocument(bytes, '오프셋.xlsx');

  assert.deepEqual(document.blocks[0].rows[0], ['설비', '']);
  assert.deepEqual(document.blocks[0].merges[0], {
    range: 'C5:D5',
    start: { row: 4, column: 2 },
    end: { row: 4, column: 3 },
  });
});

test('rejects a workbook with no non-empty sheets', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), '빈시트');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  assert.throws(
    () => extractWorkbookDocument(bytes, '빈파일.xlsx'),
    /비어|empty|content/i,
  );
});

test('worker posts structured success and handled errors for transferable Excel requests', async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['ID', '값'], ['W-1', '정상']]),
    '워커',
  );
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const messages = [];
  const workerScope = {
    postMessage(message) {
      messages.push(message);
    },
    onmessage: undefined,
  };
  const previousSelf = globalThis.self;
  globalThis.self = workerScope;
  let workerModule;

  try {
    workerModule = await import('../workers/file.worker.ts');
    await workerScope.onmessage({ data: { type: 'excel', fileName: '워커.xlsx', buffer } });
    await workerScope.onmessage({ data: { type: 'pdf', fileName: '오류.pdf', buffer } });
  } finally {
    globalThis.self = previousSelf;
  }

  assert.equal(messages[0].status, 'success');
  assert.equal(messages[0].document.fileName, '워커.xlsx');
  assert.equal(messages[0].document.blocks[0].rows[1][0], 'W-1');
  assert.equal(messages[0].text, undefined);
  assert.equal(messages[1].status, 'error');
  assert.match(messages[1].error, /Unsupported file type: pdf/);
  assert.equal(workerModule.workerErrorMessage('Thrown diagnostic'), 'Thrown diagnostic');
});
