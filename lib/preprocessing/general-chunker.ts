import {
  type ChunkDraft,
  type ChunkingOutput,
  type DocumentBlock,
  type ExtractedDocument,
  type PreprocessIssue,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './contracts.ts';
import {
  orderedListOrdinals,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './core.ts';
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
  // Bare 요 would misclassify noun titles such as "개요"; only polite
  // sentence endings count.
  return /(?:다|시오|세요|에요|예요|해요|아요|어요|네요|지요|죠)(?:[.!?。！？])?$/u.test(value) ||
    /[.!?。！？]$/u.test(value);
}

/**
 * English section titles ("GENERAL", "1. CODES AND STANDARDS", "P & ID") are
 * written in capitals in engineering specifications. Lines containing any
 * Hangul never match, so Korean handling is unaffected.
 */
export function isEnglishCapsHeading(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 4 || trimmed.length > 80) return false;
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/u.test(trimmed) || /[.!?]$/u.test(trimmed)) return false;
  const body = trimmed.replace(/^\d+(?:\.\d+)*[.)]?\s+/u, '');
  const letters = body.replace(/[^A-Za-z]/gu, '');
  return letters.length >= 3 && letters === letters.toUpperCase();
}

/** "Section 3", "Chapter 2.", "Appendix A" style English structural titles. */
function isEnglishStructuralHeading(value: string): boolean {
  return value.length <= 80 &&
    /^(?:Section|Chapter|Part|Volume|Appendix|Annex|Attachment)\s+[A-Z0-9][\w.-]*(?:\s+\S.*)?$/iu.test(value) &&
    !/[.!?]$/u.test(value.replace(/^(?:Section|Chapter|Part|Volume|Appendix|Annex|Attachment)\s+[A-Z0-9][\w.]*\.?/iu, ''));
}

function isRomanStructuralHeading(value: string): boolean {
  if (value.length > 80) return false;
  return /^(?:(?:VIII|VII|III|XII|XI|IX|VI|IV|II|X|V|I)|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ])(?:\.\s*|\s+)[가-힣]\S*(?:\s+\S+)*$/u.test(value);
}

function isNumberedFormHeading(value: string): boolean {
  return /^\[\s*서식\s+제\s*\d+\s*호(?:\s*-\s*\d+)?\s*\]$/u.test(value);
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
  if (!insideArticle && (isRomanStructuralHeading(value) || isNumberedFormHeading(value))) {
    return { text: value, inlineBody: '', kind: 'structural' };
  }
  // Circled numbers (①) and single-syllable markers (가., 나)) are list or
  // clause markers far more often than headings; promoting them fragments
  // checklists into context-only chunks.
  if (
    !insideArticle &&
    value.length <= 80 &&
    /^\d+(?:\.\d+)*(?:[.)]|\s*-\s*\d+)?\s+\S/u.test(value) &&
    !isSentenceLikeTitle(value)
  ) {
    return { text: value, inlineBody: '', kind: 'numbered' };
  }
  if (!insideArticle && (isEnglishCapsHeading(value) || isEnglishStructuralHeading(value))) {
    return { text: value, inlineBody: '', kind: 'structural' };
  }
  return null;
}

/**
 * Numbered lines that form a consecutive sibling run (1., 2., 3. on adjacent
 * lines) are a list, not a stack of headings; promoting each would fragment
 * the list into context-only chunks.
 */
function demotedNumberedLineIndexes(lines: string[]): Set<number> {
  const sequence = lines
    .map((line, index) => ({
      index,
      blank: line.trim().length === 0,
      value: line.match(/^(\d+)[.)]\s+\S/u) ? Number(line.match(/^(\d+)[.)]/u)?.[1]) : null,
    }))
    .filter((entry) => !entry.blank);
  const demoted = new Set<number>();
  for (let position = 0; position < sequence.length; position += 1) {
    const entry = sequence[position];
    if (entry.value === null) continue;
    const next = sequence[position + 1];
    const previous = sequence[position - 1];
    const nextIsSuccessor = next?.value !== null && next !== undefined && next.value === entry.value + 1;
    const previousWasDemotedPredecessor = Boolean(
      previous && demoted.has(previous.index) && previous.value === entry.value - 1,
    );
    if (nextIsSuccessor || previousWasDemotedPredecessor) demoted.add(entry.index);
  }
  return demoted;
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

function renderListItem(block: DocumentBlock, ordinal?: number): string {
  const lines = (block.text ?? '').replace(/\r\n?/gu, '\n').split('\n');
  const depth = Math.max(0, block.depth ?? 0);
  const indentation = '  '.repeat(depth);
  const marker = block.ordered ? `${ordinal ?? 1}. ` : '- ';
  const firstLine = lines[0].replace(/^\s*(?:[-*+•◦]|\d+[.)])\s+/u, '');
  const continuationIndentation = `${indentation}   `;
  return [
    `${indentation}${marker}${firstLine}`,
    ...lines.slice(1).map((line) => `${continuationIndentation}${line}`),
  ].join('\n');
}

function parseGeneralUnits(document: ExtractedDocument): GeneralUnit[] {
  const units: GeneralUnit[] = [];
  const listOrdinals = orderedListOrdinals(document.blocks);
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
    const demotedNumberedLines = demotedNumberedLineIndexes(lines);
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
      if (heading && !(heading.kind === 'numbered' && demotedNumberedLines.has(index))) {
        acceptHeading(heading, sourceId);
      } else {
        bodyLines.push({ text: line, sourceId });
      }
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
      // Word numbering-styled section headings arrive as top-level ordered
      // list items ("GENERAL", "PIPING DESIGN"); Hangul lines never qualify.
      const itemText = (block.text ?? '').trim();
      if ((block.depth ?? 0) === 0 && isEnglishCapsHeading(itemText)) {
        acceptHeading({ text: itemText, inlineBody: '', kind: 'structural' }, block.id);
      } else {
        bodyLines.push({ text: renderListItem(block, listOrdinals.get(block.id)), sourceId: block.id });
      }
    } else {
      // Style-less headings inside paragraph blocks: only unambiguous forms
      // (multi-level numbering, English capitals/structural titles) promote,
      // so single-level Korean list paragraphs stay body text.
      for (const text of (block.text ?? '').replace(/\r\n?/gu, '\n').split('\n')) {
        const heading = parseGeneralHeading(text, activeHeadingKind === 'article');
        const unambiguous = heading && (
          heading.kind === 'markdown' ||
          heading.kind === 'article' ||
          (heading.kind === 'structural') ||
          (heading.kind === 'numbered' && /^\d+\.\d+/u.test(heading.text))
        );
        if (unambiguous) acceptHeading(heading, block.id);
        else bodyLines.push({ text, sourceId: block.id });
      }
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

  // A heading with no body of its own (a parent title directly followed by a
  // subsection) would emit a context-only chunk; carry the title into the
  // next text chunk instead.
  for (let index = drafts.length - 2; index >= 0; index -= 1) {
    const draft = drafts[index];
    if (draft.body.trim().length > 0) continue;
    const title = draft.contextLines[1]?.replace(/^\[섹션\] /u, '');
    const next = drafts[index + 1];
    if (!title || title === '전문' || !next || next.body.startsWith('|')) continue;
    next.body = next.body.trim().length > 0 ? `${title}\n${next.body}` : title;
    next.sourceBlockIds = [...draft.sourceBlockIds, ...next.sourceBlockIds];
    drafts.splice(index, 1);
  }

  return {
    drafts,
    expectedSourceBlockIds: document.blocks.filter(hasSource).map((block) => block.id),
    warnings,
  };
}
