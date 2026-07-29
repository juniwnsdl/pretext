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

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const rows = displayedRows(sheet);
    if (!hasContent(rows)) return;
    const merges = sheetMerges(sheet);
    const blockNumber = blocks.length + 1;

    blocks.push({
      id: `sheet-${blockNumber}`,
      kind: 'table',
      order: blocks.length,
      headingPath: [sheetName],
      rows,
      sheetName,
      tableId: `sheet-${blockNumber}-table-1`,
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
