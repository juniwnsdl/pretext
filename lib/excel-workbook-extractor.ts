import * as XLSX from 'xlsx';

import {
  type DocumentBlock,
  type ExtractedDocument,
  type PreprocessIssue,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './preprocessing/contracts.ts';

function sourceFormat(fileName: string): string {
  const match = /\.([^.]+)$/u.exec(fileName.trim());
  return match?.[1]?.toLowerCase() || 'xlsx';
}

function sheetWidth(sheet: XLSX.WorkSheet): number {
  if (!sheet['!ref']) return 0;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  return range.e.c - range.s.c + 1;
}

function sheetRowRange(sheet: XLSX.WorkSheet): { startRow: number; endRow: number } | null {
  if (!sheet['!ref']) return null;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  return { startRow: range.s.r + 1, endRow: range.e.r + 1 };
}

function printTitleRows(
  workbook: XLSX.WorkBook,
  sheetIndex: number,
): { startRow: number; endRow: number; source: 'print-titles' } | null {
  const names = workbook.Workbook?.Names ?? [];
  const printTitle = names.find((name) =>
    name.Name === '_xlnm.Print_Titles'
      && (name.Sheet === undefined || name.Sheet === sheetIndex),
  );
  if (!printTitle?.Ref) return null;
  const match = /!\$(\d+):\$(\d+)(?:,|$)/u.exec(printTitle.Ref);
  if (!match) return null;
  const startRow = Number(match[1]);
  const endRow = Number(match[2]);
  if (!Number.isInteger(startRow) || !Number.isInteger(endRow) || startRow < 1 || endRow < startRow) {
    return null;
  }
  return { startRow, endRow, source: 'print-titles' };
}

function detectedHeaderRows(
  rows: string[][],
  usedRange: { startRow: number; endRow: number },
): { startRow: number; endRow: number; source: 'detected' } | null {
  const candidates = rows.slice(0, 20).map((row, index) => ({
    index,
    populatedCells: row.filter((cell) => cell.trim().length > 0).length,
  }));
  const dense = candidates
    .filter((candidate) => candidate.populatedCells >= 2)
    .sort((left, right) =>
      right.populatedCells - left.populatedCells || left.index - right.index,
    )[0];
  const selected = dense ?? candidates.find((candidate) => candidate.populatedCells > 0);
  if (!selected) return null;
  const rowNumber = usedRange.startRow + selected.index;
  return { startRow: rowNumber, endRow: rowNumber, source: 'detected' };
}

function displayedRows(sheet: XLSX.WorkSheet): string[][] {
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  });
  const width = sheetWidth(sheet);
  const rangeStart = sheet['!ref']
    ? XLSX.utils.decode_range(sheet['!ref']).s
    : { r: 0, c: 0 };
  const normalized = rows.map((row) => Array.from(
    { length: Math.max(width, row.length) },
    (_, column) => String(row[column] ?? ''),
  ));
  for (const merge of sheet['!merges'] ?? []) {
    for (let row = merge.s.r; row <= merge.e.r; row += 1) {
      for (let column = merge.s.c; column <= merge.e.c; column += 1) {
        if (row === merge.s.r && column === merge.s.c) continue;
        const outputRow = row - rangeStart.r;
        const outputColumn = column - rangeStart.c;
        if (normalized[outputRow]?.[outputColumn] !== undefined) {
          normalized[outputRow][outputColumn] = '';
        }
      }
    }
  }
  return normalized;
}

function hasContent(rows: string[][]): boolean {
  return rows.some((row) => row.some((cell) => cell.length > 0));
}

function sheetMerges(sheet: XLSX.WorkSheet): NonNullable<DocumentBlock['merges']> {
  return (sheet['!merges'] ?? []).map((merge) => ({
    range: XLSX.utils.encode_range(merge),
    start: { row: merge.s.r, column: merge.s.c },
    end: { row: merge.e.r, column: merge.e.c },
  }));
}

/** Extracts one structured table block per non-empty workbook sheet. */
export function extractWorkbookDocument(
  buffer: ArrayBuffer,
  fileName: string,
): ExtractedDocument {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const blocks: DocumentBlock[] = [];
  const warnings: PreprocessIssue[] = [];

  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const rows = displayedRows(sheet);
    if (!hasContent(rows)) return;
    const merges = sheetMerges(sheet);
    const usedRange = sheetRowRange(sheet);
    const headerRows = usedRange
      ? printTitleRows(workbook, sheetIndex) ?? detectedHeaderRows(rows, usedRange)
      : null;
    const blockNumber = blocks.length + 1;

    blocks.push({
      id: `sheet-${blockNumber}`,
      kind: 'table',
      order: blocks.length,
      headingPath: [sheetName],
      rows,
      sheetName,
      tableId: `sheet-${blockNumber}-table-1`,
      ...(usedRange && headerRows ? {
        excelLayout: { usedRange, headerRows },
      } : {}),
      ...(merges.length > 0 ? { merges } : {}),
    });

    if (merges.length > 0) {
      warnings.push({
        code: 'MERGED_CELLS',
        severity: 'warning',
        message: `Sheet "${sheetName}" contains merged cells; covered cells remain empty.`,
        count: merges.length,
        locations: merges.map((merge) => `${sheetName}!${merge.range}`),
      });
    }
  });

  if (blocks.length === 0) {
    throw new Error('워크북이 비어 있거나 처리할 수 있는 내용이 없습니다.');
  }

  return {
    version: 1,
    fileName,
    sourceFormat: sourceFormat(fileName),
    extractionMethod: 'local-excel',
    blocks,
    warnings,
  };
}
