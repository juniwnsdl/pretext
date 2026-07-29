import {
  APP_CHUNK_LIMIT,
  type ChunkDraft,
  type ChunkingOutput,
  type DocumentBlock,
  type PreprocessIssue,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './contracts.ts';
import {
  splitTextPreservingSeparators,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './core.ts';

type IndexedRow = { cells: string[]; index: number };

function warning(
  code: string,
  message: string,
  count?: number,
  locations?: string[],
): PreprocessIssue {
  return {
    code,
    severity: 'warning',
    message,
    ...(count === undefined ? {} : { count }),
    ...(locations === undefined ? {} : { locations }),
  };
}

function framingError(message: string): PreprocessIssue {
  return { code: 'TABLE_FRAMING_EXCEEDS_LIMIT', severity: 'error', message };
}

function normalizeCellLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/** Escapes a cell without changing quotes, commas, or meaningful whitespace. */
export function escapeMarkdownCell(value: string): string {
  return normalizeCellLineEndings(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');
}

function isEmptyRow(row: IndexedRow): boolean {
  return row.cells.every((cell) => cell.trim().length === 0);
}

function splitIntoRegions(rows: IndexedRow[]): IndexedRow[][] {
  const regions: IndexedRow[][] = [];
  let region: IndexedRow[] = [];
  for (const row of rows) {
    if (isEmptyRow(row)) {
      if (region.length > 0) regions.push(region);
      region = [];
      continue;
    }
    region.push(row);
  }
  if (region.length > 0) regions.push(region);
  return regions;
}

function renderRow(cells: string[]): string {
  return `| ${cells.map(escapeMarkdownCell).join(' | ')} |`;
}

function renderTableStart(header: string[]): string {
  return `${renderRow(header)}\n| ${header.map(() => '---').join(' | ')} |`;
}

function contextPrefixLength(contextLines: string[]): number {
  return contextLines.length === 0
    ? 0
    : contextLines.join('\n').length + 1;
}

function fragmentLinePrefix(columnIndex: number, header: string[]): string {
  const label = header[columnIndex]?.trim() || `column ${columnIndex + 1}`;
  return `행 분할: ${escapeMarkdownCell(label)}: `;
}

function splitOversizedCell(value: string, availableLength: number): string[] {
  if (!value) return [''];

  // A line break expands to four characters (<br>), the largest escaping expansion.
  const safeSourceLength = Math.max(1, Math.floor(availableLength / 4));
  return splitTextPreservingSeparators(normalizeCellLineEndings(value), safeSourceLength)
    .map(escapeMarkdownCell);
}

function renderRowFragments(row: IndexedRow, header: string[], bodyLimit: number): string[] {
  const fragments: string[] = [];
  const identifierIndex = row.cells.findIndex((cell) => cell.trim().length > 0);
  if (identifierIndex >= 0) {
    fragments.push(`행 분할: ${escapeMarkdownCell(row.cells[identifierIndex])}`);
  }
  row.cells.forEach((cell, columnIndex) => {
    if (columnIndex === identifierIndex) return;
    const prefix = fragmentLinePrefix(columnIndex, header);
    const valueLimit = Math.max(1, bodyLimit - prefix.length);
    for (const valueFragment of splitOversizedCell(cell, valueLimit)) {
      fragments.push(`${prefix}${valueFragment}`);
    }
  });
  return fragments.length > 0 ? fragments : ['행 분할'];
}

/**
 * Renders a table into row-aware chunk drafts. A source block is consumed once,
 * even when its table requires several output drafts.
 */
export function chunkTableBlock(block: DocumentBlock, contextLines: string[]): ChunkingOutput {
  const rows = (block.rows ?? []).map((cells, index) => ({ cells, index }));
  const regions = splitIntoRegions(rows);
  const warnings: PreprocessIssue[] = [];

  if (regions.length > 1) {
    warnings.push(warning(
      'MULTIPLE_TABLES',
      'Empty rows split this table block into multiple table regions.',
      regions.length,
    ));
  }

  if ((block.merges?.length ?? 0) > 0) {
    warnings.push(warning(
      'MERGED_CELLS',
      'Merged cells were preserved as extracted; no missing values were inferred.',
      block.merges?.length,
    ));
  }

  const irregularLocations = regions.flatMap((region) => {
    const headerWidth = region[0].cells.length;
    return region
      .slice(1)
      .filter((row) => row.cells.length !== headerWidth)
      .map((row) => `row ${row.index + 1}`);
  });
  if (irregularLocations.length > 0) {
    warnings.push(warning(
      'IRREGULAR_COLUMNS',
      'Rows with a different number of columns were preserved without padding.',
      irregularLocations.length,
      irregularLocations,
    ));
  }

  const drafts: ChunkDraft[] = [];
  const contextLength = contextPrefixLength(contextLines);
  let sourceConsumed = false;
  const pushDraft = (body: string): void => {
    drafts.push({
      body,
      contextLines,
      sourceBlockIds: sourceConsumed ? [] : [block.id],
      warnings: [],
    });
    sourceConsumed = true;
  };

  const blockedOutput = (message: string): ChunkingOutput => ({
    drafts: [],
    expectedSourceBlockIds: [],
    warnings: [...warnings, framingError(message)],
  });

  for (const region of regions) {
    const header = region[0].cells;
    const tableStart = renderTableStart(header);
    const bodyLimit = APP_CHUNK_LIMIT - contextLength - tableStart.length;
    const dataRows = region.slice(1);

    if (bodyLimit < 0 || (dataRows.length > 0 && bodyLimit < 2)) {
      return blockedOutput('Context and the complete repeated table header cannot fit with table body content.');
    }

    if (dataRows.length === 0) {
      pushDraft(tableStart);
      continue;
    }

    let body = tableStart;
    let hasData = false;
    const flush = (): void => {
      if (hasData) pushDraft(body);
      body = tableStart;
      hasData = false;
    };

    for (const row of dataRows) {
      const renderedRow = renderRow(row.cells);
      if (bodyLimit > 0 && renderedRow.length + 1 <= bodyLimit) {
        if (body.length + renderedRow.length + 1 <= APP_CHUNK_LIMIT - contextLength) {
          body += `\n${renderedRow}`;
          hasData = true;
          continue;
        }
        flush();
        body += `\n${renderedRow}`;
        hasData = true;
        continue;
      }

      flush();
      for (const fragment of renderRowFragments(row, header, Math.max(1, bodyLimit - 1))) {
        if (fragment.length + 1 > bodyLimit) {
          return blockedOutput('Context and the complete repeated table header leave insufficient space for a table row fragment.');
        }
        if (body.length + fragment.length + 1 > APP_CHUNK_LIMIT - contextLength && hasData) {
          flush();
        }
        body += `\n${fragment}`;
        hasData = true;
        flush();
      }
    }
    flush();
  }

  return { drafts, expectedSourceBlockIds: sourceConsumed ? [block.id] : [], warnings };
}

function isMarkdownTableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/u.test(line);
}

function splitMarkdownRow(line: string): string[] {
  const content = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    if (character === '\\' && (next === '\\' || next === '|')) {
      cell += next;
      index += 1;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()));
}

/** Extracts well-formed Markdown tables while leaving surrounding prose to its caller. */
export function extractMarkdownTableBlocks(text: string, idPrefix: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  let lines: string[] = [];
  const consume = (): void => {
    if (lines.length < 2) {
      lines = [];
      return;
    }
    const parsed = lines.map(splitMarkdownRow);
    if (!isSeparatorRow(parsed[1])) {
      lines = [];
      return;
    }
    blocks.push({
      id: `${idPrefix}-table-${blocks.length + 1}`,
      kind: 'table',
      order: blocks.length,
      headingPath: [],
      rows: [parsed[0], ...parsed.slice(2)],
    });
    lines = [];
  };

  for (const line of text.split(/\r?\n/u)) {
    if (isMarkdownTableLine(line)) {
      lines.push(line);
    } else {
      consume();
    }
  }
  consume();
  return blocks;
}
