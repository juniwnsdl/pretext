import { DOMParser } from '@xmldom/xmldom';

import {
  type DocumentBlock,
  type ExtractedDocument,
  type PreprocessIssue,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './preprocessing/contracts.ts';

interface MammothMessage {
  type?: string;
  message?: string;
}

interface MammothResult {
  value: string;
  messages?: MammothMessage[];
}

export type MammothConverter = (
  input: { arrayBuffer: ArrayBuffer },
  options: { externalFileAccess: false },
) => Promise<MammothResult>;

interface ParserLike {
  parseFromString(source: string, mimeType: string): Document;
}

const INLINE_TEXT_ELEMENTS = new Set([
  'a', 'b', 'code', 'del', 'em', 'i', 's', 'span', 'strong', 'sub', 'sup', 'u',
]);
const TEXT_CONTAINER_ELEMENTS = new Set(['p']);
const TEXT_BOUNDARY_ELEMENTS = new Set(['p']);
const TABLE_SECTION_ELEMENTS = new Set(['thead', 'tbody', 'tfoot']);

function sourceFormat(fileName: string): string {
  const match = /\.([^.]+)$/u.exec(fileName.trim());
  return match?.[1]?.toLowerCase() || 'docx';
}

function childNodes(node: Node): Node[] {
  return Array.from(node.childNodes ?? []);
}

function elementName(node: Node): string {
  return node.nodeType === 1
    ? ((node as Element).localName || (node as Element).tagName).toLowerCase()
    : '';
}

function rawSafeText(node: Node, excluded: Set<string>, root = false): string {
  const name = elementName(node);
  if (excluded.has(name)) return '';
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? '';
  if (name === 'br') return '\n';
  if (!root && !INLINE_TEXT_ELEMENTS.has(name) && !TEXT_CONTAINER_ELEMENTS.has(name)) return '';
  return childNodes(node)
    .map((child) => {
      const text = rawSafeText(child, excluded);
      return TEXT_BOUNDARY_ELEMENTS.has(elementName(child)) ? ` ${text} ` : text;
    })
    .join('');
}

function safeText(node: Node, excluded = new Set<string>()): string {
  return rawSafeText(node, excluded, true)
    .replace(/\r\n?/gu, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .trim();
}

function directChildren(node: Node, names: Set<string>): Element[] {
  return childNodes(node).filter(
    (child): child is Element => child.nodeType === 1 && names.has(elementName(child)),
  );
}

function tableRows(table: Element): Element[] {
  const rows: Element[] = [];
  const visit = (node: Node): void => {
    for (const child of childNodes(node)) {
      const name = elementName(child);
      if (name === 'tr') rows.push(child as Element);
      else if (TABLE_SECTION_ELEMENTS.has(name)) visit(child);
    }
  };
  visit(table);
  return rows;
}

function tableSpan(cell: Element, attribute: 'rowspan' | 'colspan'): number {
  const value = Number.parseInt(cell.getAttribute(attribute) ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function columnLabel(column: number): string {
  let value = column + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function cellRange(startRow: number, startColumn: number, endRow: number, endColumn: number): string {
  return `${columnLabel(startColumn)}${startRow + 1}:${columnLabel(endColumn)}${endRow + 1}`;
}

function structuredTable(table: Element): {
  rows: string[][];
  merges: NonNullable<DocumentBlock['merges']>;
} {
  const rows: Array<Array<string | undefined>> = [];
  const merges: NonNullable<DocumentBlock['merges']> = [];

  tableRows(table).forEach((row, rowIndex) => {
    rows[rowIndex] ??= [];
    let column = 0;
    for (const cell of directChildren(row, new Set(['th', 'td']))) {
      while (rows[rowIndex][column] !== undefined) column += 1;
      const rowspan = tableSpan(cell, 'rowspan');
      const colspan = tableSpan(cell, 'colspan');
      const endRow = rowIndex + rowspan - 1;
      const endColumn = column + colspan - 1;

      for (let targetRow = rowIndex; targetRow <= endRow; targetRow += 1) {
        rows[targetRow] ??= [];
        for (let targetColumn = column; targetColumn <= endColumn; targetColumn += 1) {
          if (targetRow === rowIndex && targetColumn === column) {
            rows[targetRow][targetColumn] = safeText(cell, new Set(['table']));
          } else if (rows[targetRow][targetColumn] === undefined) {
            rows[targetRow][targetColumn] = '';
          }
        }
      }

      if (rowspan > 1 || colspan > 1) {
        merges.push({
          range: cellRange(rowIndex, column, endRow, endColumn),
          start: { row: rowIndex, column },
          end: { row: endRow, column: endColumn },
        });
      }
      column = endColumn + 1;
    }
  });

  const width = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  return {
    rows: rows.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? '')),
    merges,
  };
}

function conversionWarnings(messages: MammothMessage[] | undefined): PreprocessIssue[] {
  return (messages ?? [])
    .map((message) => message.message?.trim() ?? '')
    .filter(Boolean)
    .map((message) => ({
      code: 'DOCX_CONVERSION_WARNING',
      severity: 'warning' as const,
      message,
    }));
}

/** Converts Mammoth's HTML to semantic data only; the HTML is never returned or rendered. */
export function parseMammothHtml(
  html: string,
  fileName: string,
  parser?: ParserLike,
): { blocks: DocumentBlock[]; warnings: PreprocessIssue[] } {
  const parserWarnings: string[] = [];
  const parserErrors: string[] = [];
  const quietParser = parser ?? new DOMParser({
    errorHandler: {
      warning: (message) => parserWarnings.push(message),
      error: (message) => parserErrors.push(message),
      fatalError: (message) => parserErrors.push(message),
    },
  });
  let document: Document;
  try {
    document = quietParser.parseFromString(`<docx-root>${html}</docx-root>`, 'application/xml');
  } catch (error) {
    throw new Error(
      `DOCX parser failed for "${fileName}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parserErrors.length > 0) {
    throw new Error(`DOCX parser error for "${fileName}": ${parserErrors.join('; ')}`);
  }
  const root = document.documentElement;
  if (!root) throw new Error(`DOCX extraction produced no usable content for "${fileName}".`);

  const blocks: DocumentBlock[] = [];
  const headingLevels: Array<string | undefined> = Array(6).fill(undefined);
  let tableCount = 0;

  const headingPath = (): string[] => headingLevels.filter(
    (heading): heading is string => Boolean(heading),
  );
  const append = (block: Omit<DocumentBlock, 'id' | 'order'>): void => {
    blocks.push({
      ...block,
      id: `docx-block-${blocks.length + 1}`,
      order: blocks.length,
    });
  };
  const processList = (list: Element, depth: number): void => {
    const ordered = elementName(list) === 'ol';
    const nestedNames = new Set(['ol', 'ul']);
    for (const item of directChildren(list, new Set(['li']))) {
      const text = safeText(item, nestedNames);
      if (text) {
        append({
          kind: 'list-item',
          headingPath: headingPath(),
          text,
          depth,
          ordered,
        });
      }
      for (const nested of directChildren(item, nestedNames)) processList(nested, depth + 1);
    }
  };
  const walk = (node: Node): void => {
    for (const child of childNodes(node)) {
      const name = elementName(child);
      if (/^h[1-6]$/u.test(name)) {
        const level = Number(name.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6;
        const text = safeText(child);
        if (text) {
          headingLevels[level - 1] = text;
          headingLevels.fill(undefined, level);
          append({ kind: 'heading', headingPath: headingPath(), text, level });
        }
        continue;
      }

      if (name === 'p') {
        const text = safeText(child);
        if (text) append({ kind: 'paragraph', headingPath: headingPath(), text });
        continue;
      }

      if (name === 'ol' || name === 'ul') {
        processList(child as Element, 0);
        continue;
      }

      if (name === 'table') {
        const { rows, merges } = structuredTable(child as Element);
        if (rows.some((row) => row.some((cell) => cell.length > 0))) {
          tableCount += 1;
          append({
            kind: 'table',
            headingPath: headingPath(),
            rows,
            tableId: `docx-table-${tableCount}`,
            ...(merges.length > 0 ? { merges } : {}),
          });
        }
        continue;
      }
    }
  };

  walk(root);
  if (blocks.length === 0) {
    throw new Error(`DOCX extraction produced no usable content for "${fileName}".`);
  }
  return {
    blocks,
    warnings: parserWarnings.map((message) => ({
      code: 'DOCX_PARSE_WARNING',
      severity: 'warning',
      message: `DOCX parser warning: ${message}`,
    })),
  };
}

async function defaultConverter(
  input: { arrayBuffer: ArrayBuffer },
  options: { externalFileAccess: false },
): Promise<MammothResult> {
  const mammothModule = await import('mammoth');
  const mammoth = mammothModule.default ?? mammothModule;
  return mammoth.convertToHtml(input, options);
}

/** Extracts a DOCX locally with Mammoth and emits structure-safe blocks. */
export async function extractDocxDocument(
  buffer: ArrayBuffer,
  fileName: string,
  converter: MammothConverter = defaultConverter,
): Promise<ExtractedDocument> {
  const result = await converter(
    { arrayBuffer: buffer },
    { externalFileAccess: false },
  );
  const parsed = parseMammothHtml(result.value, fileName);
  return {
    version: 1,
    fileName,
    sourceFormat: sourceFormat(fileName),
    extractionMethod: 'local-docx',
    blocks: parsed.blocks,
    warnings: [...parsed.warnings, ...conversionWarnings(result.messages)],
  };
}
