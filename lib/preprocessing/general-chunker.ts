import {
  type ChunkDraft,
  type ChunkingOutput,
  type DocumentBlock,
  type ExtractedDocument,
  type PreprocessIssue,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './contracts.ts';
import {
  parseLegalHeading,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './law-chunker.ts';
import {
  chunkTableBlock,
  extractMarkdownTableBlocks,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './table-chunker.ts';

interface GeneralHeading {
  text: string;
  inlineBody: string;
  kind: 'markdown' | 'numbered' | 'structural' | 'article';
}

interface TextUnit {
  kind: 'text';
  path: string[];
  body: string;
  sourceBlockIds: string[];
}

interface TableUnit {
  kind: 'table';
  path: string[];
  block: DocumentBlock;
  sourceBlockIds: string[];
}

type GeneralUnit = TextUnit | TableUnit;

function hasSource(block: DocumentBlock): boolean {
  return block.kind === 'table'
    ? (block.rows ?? []).some((row) => row.some((cell) => cell.trim().length > 0))
    : Boolean(block.text?.trim().length);
}

function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function stripMarkdownHeading(line: string): string | null {
  const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u);
  return match?.[1].trim() || null;
}

function isSentenceLikeTitle(value: string): boolean {
  return /(?:다|요|시오|세요)(?:[.!?。！？])?$/u.test(value) || /[.!?。！？]$/u.test(value);
}

function parseGeneralHeading(line: string, insideArticle: boolean): GeneralHeading | null {
  const markdown = stripMarkdownHeading(line);
  if (markdown) {
    const legal = parseLegalHeading(markdown);
    if (legal?.kind === 'article') {
      return {
        text: legal.heading,
        inlineBody: [legal.leadingMetadata, legal.inlineBody].filter(Boolean).join(' '),
        kind: 'article',
      };
    }
    return { text: markdown, inlineBody: '', kind: 'markdown' };
  }

  const legal = parseLegalHeading(line);
  if (legal?.kind === 'article') {
    return {
      text: legal.heading,
      inlineBody: [legal.leadingMetadata, legal.inlineBody].filter(Boolean).join(' '),
      kind: 'article',
    };
  }

  const value = line.trim();
  if (!value || line !== value) return null;
  if (/^제\s*\d+\s*(?:편|장|절|관)(?:\s+\S.*)?$/u.test(value) && !isSentenceLikeTitle(value)) {
    return { text: value, inlineBody: '', kind: 'structural' };
  }
  if (
    !insideArticle &&
    value.length <= 80 &&
    /^(?:\d+(?:\.\d+)*(?:[.)]|\s*-\s*\d+)?|[가-힣][.)]|[①-⑳])\s+\S/u.test(value) &&
    !isSentenceLikeTitle(value)
  ) {
    return { text: value, inlineBody: '', kind: 'numbered' };
  }
  return null;
}

function isMarkdownTableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/u.test(line);
}

function isMarkdownSeparatorLine(line: string): boolean {
  const cells = line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|');
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()));
}

function trimBoundaryBlankLines(lines: Array<{ text: string; sourceId: string }>): Array<{ text: string; sourceId: string }> {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].text.trim().length === 0) start += 1;
  while (end > start && lines[end - 1].text.trim().length === 0) end -= 1;
  return lines.slice(start, end);
}

function renderListItem(block: DocumentBlock): string {
  const lines = (block.text ?? '').replace(/\r\n?/gu, '\n').split('\n');
  const depth = Math.max(0, block.depth ?? 0);
  const indentation = '  '.repeat(depth);
  const marker = block.ordered ? '1. ' : '- ';
  const firstLine = lines[0].replace(/^\s*(?:[-*+•◦]|\d+[.)])\s+/u, '');
  const continuationIndentation = `${indentation}   `;
  return [
    `${indentation}${marker}${firstLine}`,
    ...lines.slice(1).map((line) => `${continuationIndentation}${line}`),
  ].join('\n');
}

function parseGeneralUnits(document: ExtractedDocument): GeneralUnit[] {
  const units: GeneralUnit[] = [];
  let activePath: string[] = [];
  let activeHeadingKind: GeneralHeading['kind'] | null = null;
  let pendingHeadingSourceIds: string[] = [];
  let bodyLines: Array<{ text: string; sourceId: string }> = [];
  let tableIndex = 0;

  const flushText = (preserveHeadingOnly: boolean = true): void => {
    const lines = trimBoundaryBlankLines(bodyLines);
    if (lines.length > 0 || (preserveHeadingOnly && pendingHeadingSourceIds.length > 0)) {
      units.push({
        kind: 'text',
        path: [...activePath],
        body: lines.map((entry) => entry.text).join('\n'),
        sourceBlockIds: unique([
          ...pendingHeadingSourceIds,
          ...lines.map((entry) => entry.sourceId),
        ]),
      });
    }
    bodyLines = [];
    pendingHeadingSourceIds = [];
  };

  const changeStructuredPath = (path: string[]): void => {
    if (samePath(activePath, path)) return;
    flushText();
    activePath = [...path];
    activeHeadingKind = null;
  };

  const acceptHeading = (heading: GeneralHeading, sourceId: string): void => {
    flushText();
    activePath = [heading.text];
    activeHeadingKind = heading.kind;
    pendingHeadingSourceIds = [sourceId];
    if (heading.inlineBody) bodyLines.push({ text: heading.inlineBody, sourceId });
  };

  const acceptTable = (tableLines: string[], sourceId: string): void => {
    if (bodyLines.some((entry) => entry.text.trim().length > 0)) flushText();
    else bodyLines = [];
    const [table] = extractMarkdownTableBlocks(
      tableLines.join('\n'),
      `${sourceId}-general-${++tableIndex}`,
    );
    if (!table) {
      bodyLines.push(...tableLines.map((text) => ({ text, sourceId })));
      return;
    }
    units.push({
      kind: 'table',
      path: [...activePath],
      block: table,
      sourceBlockIds: unique([...pendingHeadingSourceIds, sourceId]),
    });
    pendingHeadingSourceIds = [];
  };

  const acceptLines = (lines: string[], sourceId: string): void => {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (
        isMarkdownTableLine(line) &&
        index + 1 < lines.length &&
        isMarkdownSeparatorLine(lines[index + 1])
      ) {
        const tableLines: string[] = [];
        while (index < lines.length && isMarkdownTableLine(lines[index])) {
          tableLines.push(lines[index]);
          index += 1;
        }
        index -= 1;
        acceptTable(tableLines, sourceId);
        continue;
      }

      const heading = parseGeneralHeading(line, activeHeadingKind === 'article');
      if (heading) acceptHeading(heading, sourceId);
      else bodyLines.push({ text: line, sourceId });
    }
  };

  for (const block of [...document.blocks].sort((left, right) => left.order - right.order)) {
    if (!hasSource(block)) continue;

    if (block.kind === 'heading') {
      const markdown = stripMarkdownHeading(block.text ?? '') ?? block.text?.trim() ?? '';
      const parsed = parseGeneralHeading(markdown, false);
      const text = parsed?.text ?? markdown;
      const path = block.headingPath.length > 0
        ? [...block.headingPath]
        : [];
      if (text && path.at(-1) !== text) path.push(text);
      flushText();
      activePath = path;
      activeHeadingKind = parsed?.kind ?? 'structural';
      pendingHeadingSourceIds = hasSource(block) ? [block.id] : [];
      if (parsed?.inlineBody) bodyLines.push({ text: parsed.inlineBody, sourceId: block.id });
      continue;
    }

    if (block.headingPath.length > 0) changeStructuredPath(block.headingPath);
    if (block.kind === 'table') {
      if (bodyLines.some((entry) => entry.text.trim().length > 0)) flushText();
      else bodyLines = [];
      units.push({
        kind: 'table',
        path: block.headingPath.length > 0 ? [...block.headingPath] : [...activePath],
        block,
        sourceBlockIds: unique([...pendingHeadingSourceIds, block.id]),
      });
      pendingHeadingSourceIds = [];
      continue;
    }

    if (block.kind === 'raw-text') {
      acceptLines((block.text ?? '').replace(/\r\n?/gu, '\n').split('\n'), block.id);
    } else if (block.kind === 'list-item') {
      bodyLines.push({ text: renderListItem(block), sourceId: block.id });
    } else {
      bodyLines.push(
        ...(block.text ?? '').replace(/\r\n?/gu, '\n').split('\n')
          .map((text) => ({ text, sourceId: block.id })),
      );
    }
  }
  flushText();
  return units;
}

function contextLines(fileName: string, path: string[]): string[] {
  return [
    `[문서] ${fileName}`,
    `[섹션] ${path.length > 0 ? path.join(' > ') : '전문'}`,
  ];
}

function claimSourceIds(candidates: string[], claimed: Set<string>): string[] {
  const result: string[] = [];
  for (const sourceId of candidates) {
    if (!sourceId || claimed.has(sourceId)) continue;
    claimed.add(sourceId);
    result.push(sourceId);
  }
  return result;
}

/** Chunks reports and other general documents at headings and table boundaries. */
export function chunkGeneralDocument(document: ExtractedDocument): ChunkingOutput {
  const drafts: ChunkDraft[] = [];
  const warnings: PreprocessIssue[] = [...document.warnings];
  const claimed = new Set<string>();

  for (const unit of parseGeneralUnits(document)) {
    const context = contextLines(document.fileName, unit.path);
    if (unit.kind === 'table') {
      const tableOutput = chunkTableBlock(unit.block, context);
      warnings.push(...tableOutput.warnings);
      tableOutput.drafts.forEach((tableDraft, index) => {
        drafts.push({
          ...tableDraft,
          sourceBlockIds: index === 0
            ? claimSourceIds(unit.sourceBlockIds, claimed)
            : [],
        });
      });
      continue;
    }
    drafts.push({
      body: unit.body,
      contextLines: context,
      sourceBlockIds: claimSourceIds(unit.sourceBlockIds, claimed),
      warnings: [],
    });
  }

  return {
    drafts,
    expectedSourceBlockIds: document.blocks.filter(hasSource).map((block) => block.id),
    warnings,
  };
}
