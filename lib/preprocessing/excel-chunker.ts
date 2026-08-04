import * as XLSX from 'xlsx';

import {
  type ChunkDraft,
  type ChunkingOutput,
  type DocumentBlock,
  type ExcelFormulaOutput,
  type ExtractedDocument,
  type PreprocessIssue,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './contracts.ts';
import {
  APP_CHUNK_LIMIT,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './contracts.ts';
import {
  splitTextPreservingSeparators,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './core.ts';
import {
  chunkTableBlock,
  extractMarkdownTableBlocks,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './table-chunker.ts';

interface TableRegion {
  rows: string[][];
  startRow: number;
  endRow: number;
}

interface ExcelTableSource {
  block: DocumentBlock;
  sourceBlockId: string;
}

interface LayoutSection {
  rows: string[][];
  headerContext: string[];
  itemLabel?: string;
}

interface LayoutResult {
  sections: LayoutSection[];
  complexHeader: boolean;
  headerMerges: NonNullable<DocumentBlock['merges']>;
  emptyHeaderColumns: number[];
}

const COMPLEX_EXCEL_HEADER_MESSAGE =
  '복잡한 병합·다단 머리행이 감지되었습니다. 일부 열 이름이 데이터와 정확히 연결되지 않을 수 있습니다. 원본과 결과를 비교하거나 ‘엑셀 머리행 설정’에서 머리행 범위를 확인하세요.';

function isFullyEmptyRow(row: string[]): boolean {
  return row.every((cell) => cell.trim().length === 0);
}

function splitTableRegions(rows: string[][]): TableRegion[] {
  const regions: TableRegion[] = [];
  let startRow = -1;
  let regionRows: string[][] = [];

  const consume = (endRow: number): void => {
    if (regionRows.length > 0) {
      regions.push({ rows: regionRows, startRow, endRow });
    }
    startRow = -1;
    regionRows = [];
  };

  rows.forEach((row, rowIndex) => {
    if (isFullyEmptyRow(row)) {
      consume(rowIndex - 1);
      return;
    }
    if (startRow < 0) startRow = rowIndex;
    regionRows.push(row);
  });
  consume(rows.length - 1);
  return regions;
}

function itemSectionLabel(row: string[]): string | null {
  const populated = row.map((cell) => cell.trim()).filter(Boolean);
  if (populated.length !== 1) return null;
  const match = /^(?:item|항목)\s*[:：]\s*(.+)$/iu.exec(populated[0]);
  return match?.[1]?.trim() || null;
}

function headerContextLine(row: string[]): string | null {
  const populated = row.map((cell) => cell.trim()).filter(Boolean);
  return populated.length > 0 ? populated.join(' | ') : null;
}

function normalizeHeaderSegment(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/giu, ' ')
    .replace(/\r\n?|\n/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function mergeAnchorValue(
  block: DocumentBlock,
  relativeRow: number,
  relativeColumn: number,
): string {
  const layout = block.excelLayout;
  const rows = block.rows ?? [];
  if (!layout) return rows[relativeRow]?.[relativeColumn] ?? '';
  const absoluteRow = layout.usedRange.startRow - 1 + relativeRow;
  const absoluteColumn = (layout.usedRange.startColumn ?? 1) - 1 + relativeColumn;
  const merge = block.merges?.find((candidate) =>
    absoluteRow >= candidate.start.row
      && absoluteRow <= candidate.end.row
      && absoluteColumn >= candidate.start.column
      && absoluteColumn <= candidate.end.column
      && candidate.start.row >= layout.headerRows.startRow - 1
      && candidate.end.row <= layout.headerRows.endRow - 1,
  );
  if (!merge) return rows[relativeRow]?.[relativeColumn] ?? '';
  const anchorRow = merge.start.row - (layout.usedRange.startRow - 1);
  const anchorColumn = merge.start.column - ((layout.usedRange.startColumn ?? 1) - 1);
  return rows[anchorRow]?.[anchorColumn] ?? '';
}

function composedHeaderRow(
  block: DocumentBlock,
  headerRowIndexes: number[],
): string[] {
  const rows = block.rows ?? [];
  const width = Math.max(0, ...rows.map((row) => row.length));
  return Array.from({ length: width }, (_, column) => {
    const segments: string[] = [];
    for (const rowIndex of headerRowIndexes) {
      const segment = normalizeHeaderSegment(mergeAnchorValue(block, rowIndex, column));
      if (!segment || segments.at(-1) === segment) continue;
      segments.push(segment);
    }
    return segments.join(' > ');
  });
}

function rowsWithFormulaOutput(
  block: DocumentBlock,
  formulaOutput: ExcelFormulaOutput,
): string[][] {
  const rows = block.rows ?? [];
  const layout = block.excelLayout;
  if (formulaOutput !== 'value-and-formula' || !layout || !block.formulaCells?.length) {
    return rows;
  }
  const output = rows.map((row) => [...row]);
  const startColumn = layout.usedRange.startColumn ?? 1;
  for (const formulaCell of block.formulaCells) {
    const row = formulaCell.row - layout.usedRange.startRow;
    const column = formulaCell.column - startColumn;
    if (!output[row] || column < 0 || column >= output[row].length) continue;
    const displayedValue = output[row][column];
    output[row][column] = displayedValue.trim()
      ? `${displayedValue} (수식: ${formulaCell.formula})`
      : `(수식: ${formulaCell.formula})`;
  }
  return output;
}

function layoutSections(block: DocumentBlock): LayoutResult | null {
  const layout = block.excelLayout;
  const rows = block.rows ?? [];
  if (!layout || rows.length === 0) return null;

  const headerStart = layout.headerRows.startRow - layout.usedRange.startRow;
  const headerEnd = layout.headerRows.endRow - layout.usedRange.startRow;
  if (
    headerStart < 0
    || headerEnd < headerStart
    || headerStart >= rows.length
    || headerEnd >= rows.length
  ) {
    return null;
  }

  const selectedHeaders = rows
    .slice(headerStart, headerEnd + 1)
    .map((row, index) => ({
      absoluteIndex: headerStart + index,
      populatedCells: populatedCellCount(row),
    }));
  const nonEmptyHeaders = selectedHeaders.filter((candidate) => candidate.populatedCells > 0);
  if (nonEmptyHeaders.length === 0) return null;

  const headerMerges = (block.merges ?? []).filter((merge) =>
    merge.end.row >= layout.headerRows.startRow - 1
      && merge.start.row <= layout.headerRows.endRow - 1,
  );
  const hasContainedHeaderMerge = headerMerges.some((merge) =>
    merge.start.row >= layout.headerRows.startRow - 1
      && merge.end.row <= layout.headerRows.endRow - 1,
  );

  const mayPeelTitleRows =
    layout.headerRows.source !== 'manual' && !hasContainedHeaderMerge;
  let firstHeaderIndex = 0;
  while (
    mayPeelTitleRows
    &&
    firstHeaderIndex < nonEmptyHeaders.length - 1
    && nonEmptyHeaders[firstHeaderIndex].populatedCells === 1
    && nonEmptyHeaders.slice(firstHeaderIndex + 1).some((candidate) => candidate.populatedCells >= 2)
  ) {
    firstHeaderIndex += 1;
  }
  const titleHeaderIndexes = nonEmptyHeaders
    .slice(0, firstHeaderIndex)
    .map((candidate) => candidate.absoluteIndex);
  const columnHeaderIndexes = nonEmptyHeaders
    .slice(firstHeaderIndex)
    .map((candidate) => candidate.absoluteIndex);
  const columnHeader = composedHeaderRow(block, columnHeaderIndexes);
  if (!columnHeader.some((cell) => cell.length > 0)) return null;

  const contextRows = [
    ...rows.slice(0, headerStart),
    ...titleHeaderIndexes.map((index) => rows[index]),
  ];
  const headerContext = contextRows
    .map(headerContextLine)
    .filter((line): line is string => line !== null);
  const startColumn = layout.usedRange.startColumn ?? 1;
  const emptyHeaderColumns = columnHeader.flatMap((cell, index) =>
    cell.length === 0 ? [startColumn + index] : [],
  );
  const sections: LayoutSection[] = [];
  let itemLabel: string | undefined;
  let dataRows: string[][] = [];
  const consume = (): void => {
    if (dataRows.length > 0) {
      sections.push({
        rows: [columnHeader, ...dataRows],
        headerContext,
        ...(itemLabel ? { itemLabel } : {}),
      });
    }
    dataRows = [];
  };

  for (const row of rows.slice(headerEnd + 1)) {
    if (isFullyEmptyRow(row)) {
      consume();
      continue;
    }
    const nextItemLabel = itemSectionLabel(row);
    if (nextItemLabel) {
      consume();
      itemLabel = nextItemLabel;
      continue;
    }
    dataRows.push(row);
  }
  consume();

  return {
    sections: sections.length > 0
      ? sections
      : [{ rows: [columnHeader], headerContext }],
    complexHeader: columnHeaderIndexes.length > 1 || headerMerges.length > 0,
    headerMerges,
    emptyHeaderColumns,
  };
}

function markdownTables(text: string, idPrefix: string): DocumentBlock[] {
  return extractMarkdownTableBlocks(text, idPrefix);
}

function csvTable(text: string, idPrefix: string): DocumentBlock[] {
  if (!text.trim()) return [];
  const workbook = XLSX.read(text, { type: 'string' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  });
  if (!rows.some((row) => row.some((cell) => String(cell).length > 0))) return [];
  return [{
    id: `${idPrefix}-table-1`,
    kind: 'table',
    order: 0,
    headingPath: [],
    rows: rows.map((row) => row.map((cell) => String(cell))),
  }];
}

interface ExcelProseSource {
  kind: 'prose';
  text: string;
  sourceBlockId: string;
  sheetName: string;
}

interface ExcelFlatSource {
  kind: 'table';
  table: ExcelTableSource;
}

type ExcelFlatSegment = ExcelProseSource | ExcelFlatSource;

function isMarkdownTableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/u.test(line);
}

/** Splits a flat block into ordered prose and table segments so prose survives. */
function flatSegments(document: ExtractedDocument): ExcelFlatSegment[] {
  return document.blocks.flatMap((block): ExcelFlatSegment[] => {
    if (block.kind !== 'raw-text' || !block.text?.trim()) return [];
    const sheetName = block.sheetName || document.fileName;
    const parsedMarkdown = markdownTables(block.text, `${block.id}-markdown`);
    if (parsedMarkdown.length === 0) {
      const parsed = csvTable(block.text, `${block.id}-csv`);
      return parsed.map((table) => ({
        kind: 'table',
        table: { sourceBlockId: block.id, block: { ...table, sheetName } },
      }));
    }

    const segments: ExcelFlatSegment[] = [];
    let tableNumber = 0;
    let proseLines: string[] = [];
    let tableRunLines: string[] = [];
    const flushProse = (): void => {
      const text = proseLines.join('\n').trim();
      proseLines = [];
      if (text) segments.push({ kind: 'prose', text, sourceBlockId: block.id, sheetName });
    };
    const flushTableRun = (): void => {
      if (tableRunLines.length === 0) return;
      const [table] = extractMarkdownTableBlocks(
        tableRunLines.join('\n'),
        `${block.id}-markdown-run-${tableNumber + 1}`,
      );
      if (table) {
        flushProse();
        tableNumber += 1;
        segments.push({
          kind: 'table',
          table: { sourceBlockId: block.id, block: { ...table, sheetName } },
        });
      } else {
        proseLines.push(...tableRunLines);
      }
      tableRunLines = [];
    };

    for (const line of block.text.replace(/\r\n?/gu, '\n').split('\n')) {
      if (isMarkdownTableLine(line)) {
        tableRunLines.push(line);
        continue;
      }
      flushTableRun();
      proseLines.push(line);
    }
    flushTableRun();
    flushProse();
    return segments;
  });
}

function structuredTableSources(document: ExtractedDocument): ExcelTableSource[] {
  return document.blocks
    .filter((block) => block.kind === 'table')
    .map((block) => ({ block, sourceBlockId: block.id }));
}

function warningForMultipleTables(
  sheetName: string,
  sourceBlockId: string,
  count: number,
): PreprocessIssue {
  return {
    code: 'MULTIPLE_TABLES',
    severity: 'warning',
    message: `Empty rows split sheet "${sheetName}" into multiple table regions.`,
    count,
    locations: [`${sheetName}:${sourceBlockId}`],
  };
}

function hasMergeWarningForSheet(
  warnings: PreprocessIssue[],
  sheetName: string,
): boolean {
  return warnings.some((issue) =>
    issue.code === 'MERGED_CELLS'
      && (!issue.locations || issue.locations.some((location) => location.startsWith(`${sheetName}!`))),
  );
}

function populatedCellCount(row: string[]): number {
  return row.filter((cell) => cell.trim().length > 0).length;
}

/**
 * Rows above the column header that carry a single populated cell are sheet
 * or table titles; keep them as context instead of letting one become the
 * column header for every following chunk.
 */
function peelTitleRows(rows: string[][]): { rows: string[][]; headerContext: string[] } {
  let remaining = rows;
  const headerContext: string[] = [];
  while (
    remaining.length > 1 &&
    populatedCellCount(remaining[0]) === 1 &&
    populatedCellCount(remaining[1]) >= 2
  ) {
    const title = headerContextLine(remaining[0]);
    if (title) headerContext.push(title);
    remaining = remaining.slice(1);
  }
  return { rows: remaining, headerContext };
}

function isDataLikeCell(cell: string): boolean {
  const value = cell.trim();
  if (!value) return false;
  return /^[-+]?[\d,]+(?:\.\d+)?\s*(?:%|℃|°C|㎜|mm|cm|m|kg|t|kW|MW|kV|V|A|Hz|bar|MPa|kPa|시간|분|초|회|명|개|건|호기)?$/u.test(value) ||
    /^\d{4}[-./년]\s?\d{1,2}(?:[-./월]\s?\d{1,2}일?)?$/u.test(value) ||
    /^\d{1,2}[:시]\d{2}분?$/u.test(value);
}

function isDataLikeRow(row: string[]): boolean {
  return row.some(isDataLikeCell);
}

/**
 * A stray blank row inside one table would otherwise promote the next data
 * row to a column header; when the following region has the same width, no
 * title of its own, and starts with data-like cells, treat it as a
 * continuation of the previous table.
 */
function mergeContinuationRegions(
  sections: LayoutSection[],
  onMerge: () => void,
): LayoutSection[] {
  const merged: LayoutSection[] = [];
  for (const section of sections) {
    const previous = merged.at(-1);
    if (
      previous &&
      section.headerContext.length === 0 &&
      previous.rows.length >= 2 &&
      section.rows.length >= 1 &&
      section.rows[0].length === previous.rows[0].length &&
      isDataLikeRow(section.rows[0]) &&
      !isDataLikeRow(previous.rows[0])
    ) {
      previous.rows = [...previous.rows, ...section.rows];
      onMerge();
      continue;
    }
    merged.push(section);
  }
  return merged;
}

/** Chunks workbook sheets without allowing table regions or sheets to mix. */
export function chunkWorkbookDocument(document: ExtractedDocument): ChunkingOutput {
  const structured = structuredTableSources(document);
  const segments: ExcelFlatSegment[] = structured.length > 0
    ? structured.map((table) => ({ kind: 'table', table }))
    : flatSegments(document);
  const drafts: ChunkDraft[] = [];
  const warnings: PreprocessIssue[] = [...document.warnings];
  const expectedSourceBlockIds: string[] = [];
  const consumedSourceIds = new Set<string>();
  const tableCountsBySheet = new Map<string, number>();
  const claimSource = (sourceBlockId: string): string[] => {
    if (consumedSourceIds.has(sourceBlockId)) return [];
    consumedSourceIds.add(sourceBlockId);
    expectedSourceBlockIds.push(sourceBlockId);
    return [sourceBlockId];
  };

  for (const segment of segments) {
    if (segment.kind === 'prose') {
      const contextLines = [`[파일] ${document.fileName}`, `[시트] ${segment.sheetName}`];
      const bodyLimit = Math.max(1, APP_CHUNK_LIMIT - contextLines.join('\n').length - 1);
      for (const body of splitTextPreservingSeparators(segment.text, bodyLimit)) {
        drafts.push({
          body,
          contextLines,
          sourceBlockIds: claimSource(segment.sourceBlockId),
          warnings: [],
        });
      }
      continue;
    }

    const { block, sourceBlockId } = segment.table;
    const displayBlock: DocumentBlock = {
      ...block,
      rows: rowsWithFormulaOutput(block, document.excelOptions?.formulaOutput ?? 'value-only'),
    };
    const sheetName = block.sheetName || document.fileName;
    const detectedLayout = layoutSections(displayBlock);
    const detectedSections = detectedLayout?.sections ?? null;
    let continuationMergeCount = 0;
    const regions: LayoutSection[] = detectedSections ?? mergeContinuationRegions(
      splitTableRegions(displayBlock.rows ?? []).map((region) => {
        const peeled = peelTitleRows(region.rows);
        return {
          rows: peeled.rows,
          headerContext: peeled.headerContext,
        };
      }),
      () => { continuationMergeCount += 1; },
    );
    if (continuationMergeCount > 0) {
      warnings.push({
        code: 'TABLE_CONTINUATION_MERGED',
        severity: 'warning',
        message: `Data rows after a blank row in sheet "${sheetName}" were merged into the preceding table.`,
        count: continuationMergeCount,
        locations: [`${sheetName}:${sourceBlockId}`],
      });
    }
    if (detectedLayout?.complexHeader) {
      warnings.push({
        code: 'COMPLEX_EXCEL_HEADER',
        severity: 'warning',
        message: COMPLEX_EXCEL_HEADER_MESSAGE,
        count: detectedLayout.headerMerges.length || undefined,
        locations: detectedLayout.headerMerges.length > 0
          ? detectedLayout.headerMerges.map((merge) => `${sheetName}!${merge.range}`)
          : [`${sheetName}:${sourceBlockId}`],
      });
    }
    if (detectedLayout && detectedLayout.emptyHeaderColumns.length > 0) {
      warnings.push({
        code: 'EMPTY_EXCEL_HEADER',
        severity: 'warning',
        message: `시트 "${sheetName}"의 일부 열에 머리행 제목이 없습니다. 원본과 결과를 비교하세요.`,
        count: detectedLayout.emptyHeaderColumns.length,
        locations: detectedLayout.emptyHeaderColumns.map((column) => {
          const label = XLSX.utils.encode_col(column - 1);
          return `${sheetName}!${label}:${label}`;
        }),
      });
    }
    const mergesAlreadyWarned = hasMergeWarningForSheet(document.warnings, sheetName);
    if (!detectedSections && regions.length > 1) {
      warnings.push(warningForMultipleTables(sheetName, sourceBlockId, regions.length));
    }

    for (const [regionIndex, region] of regions.entries()) {
      const tableNumber = (tableCountsBySheet.get(sheetName) ?? 0) + 1;
      tableCountsBySheet.set(sheetName, tableNumber);
      const regionBlock: DocumentBlock = {
        ...displayBlock,
        id: `${block.id}-region-${regionIndex + 1}`,
        rows: region.rows,
        merges: mergesAlreadyWarned || regionIndex > 0 ? undefined : block.merges,
      };
      const output = chunkTableBlock(regionBlock, [
        `[파일] ${document.fileName}`,
        `[시트] ${sheetName}`,
        ...region.headerContext.map((line) => `[머리행] ${line}`),
        ...(region.itemLabel ? [`[항목] ${region.itemLabel}`] : [`[표] ${tableNumber}`]),
      ]);
      warnings.push(...output.warnings);

      for (const draft of output.drafts) {
        const consumesSource = draft.sourceBlockIds.length > 0
          && !consumedSourceIds.has(sourceBlockId);
        drafts.push({
          ...draft,
          sourceBlockIds: consumesSource ? [sourceBlockId] : [],
        });
        if (consumesSource) {
          consumedSourceIds.add(sourceBlockId);
          expectedSourceBlockIds.push(sourceBlockId);
        }
      }
    }
  }

  return { drafts, expectedSourceBlockIds, warnings };
}
