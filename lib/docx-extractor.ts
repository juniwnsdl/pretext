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

const SKIPPED_ELEMENTS = new Set(['script', 'style', 'img']);
const TEXT_BOUNDARY_ELEMENTS = new Set(['div', 'li', 'p']);

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

function rawSafeText(node: Node, excluded: Set<string>): string {
  const name = elementName(node);
  if (SKIPPED_ELEMENTS.has(name) || excluded.has(name)) return '';
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? '';
  return childNodes(node)
    .map((child) => {
      const text = rawSafeText(child, excluded);
      return TEXT_BOUNDARY_ELEMENTS.has(elementName(child)) ? ` ${text} ` : text;
    })
    .join('');
}

function safeText(node: Node, excluded = new Set<string>()): string {
  return rawSafeText(node, excluded)
    .replace(/\s+/gu, ' ')
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
      if (name === 'table') continue;
      if (name === 'tr') rows.push(child as Element);
      else visit(child);
    }
  };
  visit(table);
  return rows;
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
  const quietParser = parser ?? new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: () => undefined,
      fatalError: () => undefined,
    },
  });
  const document = quietParser.parseFromString(`<docx-root>${html}</docx-root>`, 'application/xml');
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
      if (SKIPPED_ELEMENTS.has(name)) continue;

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
        const rows = tableRows(child as Element)
          .map((row) => directChildren(row, new Set(['th', 'td']))
            .map((cell) => safeText(cell, new Set(['table']))));
        if (rows.some((row) => row.some((cell) => cell.length > 0))) {
          tableCount += 1;
          append({
            kind: 'table',
            headingPath: headingPath(),
            rows,
            tableId: `docx-table-${tableCount}`,
          });
        }
        continue;
      }

      walk(child);
    }
  };

  walk(root);
  if (blocks.length === 0) {
    throw new Error(`DOCX extraction produced no usable content for "${fileName}".`);
  }
  return { blocks, warnings: [] };
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
