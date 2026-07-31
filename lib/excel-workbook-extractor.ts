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

function sheetUsedRange(sheet: XLSX.WorkSheet): {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
} | null {
  if (!sheet['!ref']) return null;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  return {
    startRow: range.s.r + 1,
    endRow: range.e.r + 1,
    startColumn: range.s.c + 1,
    endColumn: range.e.c + 1,
  };
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
  usedRange: { startRow: number; endRow: number; startColumn?: number },
  merges: NonNullable<DocumentBlock['merges']>,
): { startRow: number; endRow: number; source: 'detected' } | null {
  const usedStartRow = usedRange.startRow - 1;
  const horizontalMerges = merges
    .filter((merge) =>
      merge.end.column > merge.start.column
        && merge.start.row >= usedStartRow
        && merge.start.row < usedStartRow + Math.min(rows.length, 20),
    )
    .sort((left, right) => left.start.row - right.start.row);
  for (const horizontalMerge of horizontalMerges) {
    const bandStart = horizontalMerge.start.row;
    const bandStartIndex = bandStart - usedStartRow;
    if (rows.slice(0, bandStartIndex).some((row) =>
      row.filter((cell) => cell.trim().length > 0).length >= 2,
    )) {
      continue;
    }
    const bandMerges = merges.filter((merge) => merge.start.row === bandStart);
    let bandEnd = Math.max(...bandMerges.map((merge) => merge.end.row));
    let bottomRelativeIndex = bandEnd - usedStartRow;
    if (
      bandEnd === bandStart
      && rows[bottomRelativeIndex + 1]?.filter((cell) => cell.trim().length > 0).length >= 2
    ) {
      bandEnd += 1;
      bottomRelativeIndex += 1;
    }
    const bottomPopulated = rows[bottomRelativeIndex]
      ?.filter((cell) => cell.trim().length > 0).length ?? 0;
    const usedStartColumn = (usedRange.startColumn ?? 1) - 1;
    const childStartColumn = horizontalMerge.start.column - usedStartColumn;
    const childEndColumn = horizontalMerge.end.column - usedStartColumn;
    const childLabels = rows[bottomRelativeIndex]
      ?.slice(childStartColumn, childEndColumn + 1)
      .filter((cell) => cell.trim().length > 0).length ?? 0;
    if (bandEnd > bandStart && bottomPopulated >= 2 && childLabels >= 2) {
      return { startRow: bandStart + 1, endRow: bandEnd + 1, source: 'detected' };
    }
  }

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

export function extractSheetFormulaCells(
  sheet: XLSX.WorkSheet,
): NonNullable<DocumentBlock['formulaCells']> {
  const formulaCells: NonNullable<DocumentBlock['formulaCells']> = [];
  for (const address of Object.keys(sheet)) {
    if (address.startsWith('!')) continue;
    const cell = sheet[address] as XLSX.CellObject | undefined;
    if (!cell || typeof cell.f !== 'string' || cell.f.length === 0) continue;
    const coordinate = XLSX.utils.decode_cell(address);
    formulaCells.push({
      row: coordinate.r + 1,
      column: coordinate.c + 1,
      formula: cell.f.startsWith('=') ? cell.f : `=${cell.f}`,
      hasStoredResult: cell.v !== undefined && cell.v !== null,
    });
  }
  return formulaCells.sort((left, right) => left.row - right.row || left.column - right.column);
}

/** Extracts one structured table block per non-empty workbook sheet. */
export function extractWorkbookDocument(
  buffer: ArrayBuffer,
  fileName: string,
): ExtractedDocument {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellFormula: true });
  const blocks: DocumentBlock[] = [];
  const warnings: PreprocessIssue[] = [];
  const missingFormulaResultLocations: string[] = [];

  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const rows = displayedRows(sheet);
    const formulaCells = extractSheetFormulaCells(sheet);
    if (!hasContent(rows) && formulaCells.length === 0) return;
    const merges = sheetMerges(sheet);
    const usedRange = sheetUsedRange(sheet);
    const headerRows = usedRange
      ? printTitleRows(workbook, sheetIndex)
        ?? detectedHeaderRows(rows, usedRange, merges)
        ?? (formulaCells[0] ? {
          startRow: formulaCells[0].row,
          endRow: formulaCells[0].row,
          source: 'detected' as const,
        } : null)
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
      ...(formulaCells.length > 0 ? { formulaCells } : {}),
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
    const missingFormulaResults = formulaCells.filter((cell) => !cell.hasStoredResult);
    missingFormulaResultLocations.push(...missingFormulaResults.map((cell) =>
      `${sheetName}!${XLSX.utils.encode_cell({ r: cell.row - 1, c: cell.column - 1 })}`,
    ));
  });

  if (missingFormulaResultLocations.length > 0) {
    warnings.push({
      code: 'FORMULA_RESULT_MISSING',
      severity: 'warning',
      message: '저장된 결과가 없는 수식 셀이 있습니다. 이 앱은 수식을 다시 계산하지 않으므로 원본 Excel에서 확인하세요.',
      count: missingFormulaResultLocations.length,
      locations: missingFormulaResultLocations,
    });
  }

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
    excelOptions: { formulaOutput: 'value-only' },
  };
}
