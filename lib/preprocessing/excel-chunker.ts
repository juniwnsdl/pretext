import * as XLSX from 'xlsx';

import {
  type ChunkDraft,
  type ChunkingOutput,
  type DocumentBlock,
  type ExtractedDocument,
  type PreprocessIssue,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './contracts.ts';
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

function flatTableSources(document: ExtractedDocument): ExcelTableSource[] {
  return document.blocks.flatMap((block) => {
    if (block.kind !== 'raw-text' || !block.text?.trim()) return [];
    const parsedMarkdown = markdownTables(block.text, `${block.id}-markdown`);
    const parsed = parsedMarkdown.length > 0
      ? parsedMarkdown
      : csvTable(block.text, `${block.id}-csv`);
    return parsed.map((table) => ({
      sourceBlockId: block.id,
      block: {
        ...table,
        sheetName: block.sheetName || document.fileName,
      },
    }));
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

/** Chunks workbook sheets without allowing table regions or sheets to mix. */
export function chunkWorkbookDocument(document: ExtractedDocument): ChunkingOutput {
  const structured = structuredTableSources(document);
  const sources = structured.length > 0 ? structured : flatTableSources(document);
  const drafts: ChunkDraft[] = [];
  const warnings: PreprocessIssue[] = [...document.warnings];
  const expectedSourceBlockIds: string[] = [];
  const consumedSourceIds = new Set<string>();
  const tableCountsBySheet = new Map<string, number>();

  for (const { block, sourceBlockId } of sources) {
    const sheetName = block.sheetName || document.fileName;
    const regions = splitTableRegions(block.rows ?? []);
    const mergesAlreadyWarned = hasMergeWarningForSheet(document.warnings, sheetName);
    if (regions.length > 1) {
      warnings.push(warningForMultipleTables(sheetName, sourceBlockId, regions.length));
    }

    for (const [regionIndex, region] of regions.entries()) {
      const tableNumber = (tableCountsBySheet.get(sheetName) ?? 0) + 1;
      tableCountsBySheet.set(sheetName, tableNumber);
      const regionBlock: DocumentBlock = {
        ...block,
        id: `${block.id}-region-${regionIndex + 1}`,
        rows: region.rows,
        merges: mergesAlreadyWarned || regionIndex > 0 ? undefined : block.merges,
      };
      const output = chunkTableBlock(regionBlock, [
        `[파일] ${document.fileName}`,
        `[시트] ${sheetName}`,
        `[표] ${tableNumber}`,
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
