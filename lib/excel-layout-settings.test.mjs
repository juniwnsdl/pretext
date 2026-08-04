import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyExcelProcessingSettings,
  applyManualExcelHeaderRows,
  getExcelFormulaOutput,
  getExcelSheetSettings,
} from './excel-layout-settings.ts';

function workbookDocument() {
  return {
    version: 1,
    fileName: 'suppliers.xlsx',
    sourceFormat: 'xlsx',
    extractionMethod: 'local-excel',
    blocks: [{
      id: 'sheet-1',
      kind: 'table',
      order: 0,
      headingPath: ['Suppliers'],
      sheetName: 'Suppliers',
      rows: [
        ['Title', ''],
        ['No.', 'Vendor'],
        ['1', 'Vendor A'],
      ],
      excelLayout: {
        usedRange: { startRow: 2, endRow: 4 },
        headerRows: { startRow: 3, endRow: 3, source: 'detected' },
      },
    }],
    warnings: [],
  };
}

test('lists editable Excel header rows and applies a manual range without mutating extraction', () => {
  const document = workbookDocument();

  assert.deepEqual(getExcelSheetSettings(document), [{
    blockId: 'sheet-1',
    sheetName: 'Suppliers',
    startRow: 3,
    endRow: 3,
    minimumRow: 2,
    maximumRow: 4,
    source: 'detected',
  }]);

  const updated = applyManualExcelHeaderRows(document, [{
    blockId: 'sheet-1',
    startRow: 2,
    endRow: 3,
  }]);

  assert.equal(document.blocks[0].excelLayout.headerRows.source, 'detected');
  assert.deepEqual(updated.blocks[0].excelLayout.headerRows, {
    startRow: 2,
    endRow: 3,
    source: 'manual',
  });
  assert.notEqual(updated, document);
  assert.notEqual(updated.blocks[0], document.blocks[0]);
});

test('rejects missing sheets and header rows outside the extracted range', () => {
  const document = workbookDocument();

  assert.throws(
    () => applyManualExcelHeaderRows(document, [{ blockId: 'missing', startRow: 2, endRow: 3 }]),
    /sheet|block/i,
  );
  assert.throws(
    () => applyManualExcelHeaderRows(document, [{ blockId: 'sheet-1', startRow: 1, endRow: 3 }]),
    /2.*4|range/i,
  );
  assert.throws(
    () => applyManualExcelHeaderRows(document, [{ blockId: 'sheet-1', startRow: 4, endRow: 3 }]),
    /start|range/i,
  );
});

test('defaults formula output and immutably applies formula and header settings together', () => {
  const document = workbookDocument();

  assert.equal(getExcelFormulaOutput(document), 'value-only');
  const updated = applyExcelProcessingSettings(document, {
    headerRows: [{ blockId: 'sheet-1', startRow: 2, endRow: 3 }],
    formulaOutput: 'value-and-formula',
  });

  assert.equal(getExcelFormulaOutput(updated), 'value-and-formula');
  assert.equal(document.excelOptions, undefined);
  assert.deepEqual(updated.blocks[0].excelLayout.headerRows, {
    startRow: 2,
    endRow: 3,
    source: 'manual',
  });
  assert.notEqual(updated, document);
});

test('rejects invalid formula output without weakening existing header validation', () => {
  const document = workbookDocument();

  assert.throws(
    () => applyExcelProcessingSettings(document, {
      headerRows: [],
      formulaOutput: 'formula-only',
    }),
    /formula|output/i,
  );
  assert.throws(
    () => applyExcelProcessingSettings(document, {
      headerRows: [{ blockId: 'sheet-1', startRow: 1, endRow: 3 }],
      formulaOutput: 'value-only',
    }),
    /2.*4|range/i,
  );
});
