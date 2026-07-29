import {
  APP_CHUNK_LIMIT,
  type ChunkDraft,
  type ChunkingOutput,
  type DocumentBlock,
  type ExtractedDocument,
  type PreprocessIssue,
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

type HierarchyKind = 'part' | 'chapter' | 'section' | 'subsection';

interface HierarchyState {
  part: string | null;
  chapter: string | null;
  section: string | null;
  subsection: string | null;
}

interface ParsedLegalHeading {
  kind: HierarchyKind | 'article' | 'addendum' | 'appendix' | 'form';
  heading: string;
  inlineBody: string;
  leadingMetadata: string;
}

interface TextUnit {
  kind: 'text';
  location: string[];
  body: string;
}

interface TableUnit {
  kind: 'table';
  location: string[];
  block: DocumentBlock;
}

type LegalUnit = TextUnit | TableUnit;

const DELEGATION_MANUAL_TITLE = '[위임전결규정 매뉴얼]';
const DELEGATION_CATEGORY_PATTERN = /^([A-J])\.\s+\S/u;

const paragraphPatterns = [
  /(?=^[①-⑳]\s*)/gmu,
  /(?=^\d+[.)]\s*)/gmu,
  /(?=^[가-힣][.)]\s*)/gmu,
];

function stripMarkdownHeading(line: string): string {
  let value = line.trim().replace(/^#{1,6}\s+/u, '').trim();
  const wrappers = [
    [/^\*\*(.*)\*\*$/u, '$1'],
    [/^__(.*)__$/u, '$1'],
    [/^~~(.*)~~$/u, '$1'],
    [/^`(.*)`$/u, '$1'],
  ] as const;

  let changed = true;
  while (changed) {
    changed = false;
    for (const [pattern, replacement] of wrappers) {
      const unwrapped = value.replace(pattern, replacement).trim();
      if (unwrapped !== value) {
        value = unwrapped;
        changed = true;
      }
    }
  }
  return value;
}

function parseLegalHeading(line: string): ParsedLegalHeading | null {
  const trimmed = stripMarkdownHeading(line);
  if (!trimmed) return null;

  const metadataMatch = trimmed.match(
    /^((?:(?:\d+\.)+\s*)?(?:\[(?:\d+\.)+\]\s*)?)(?=제\s*\d+)/u,
  );
  const leadingMetadata = metadataMatch?.[1].trim() ?? '';
  const value = leadingMetadata
    ? trimmed.slice(metadataMatch?.[1].length ?? 0).trim()
    : trimmed;

  const articleMatch = value.match(
    /^(제\s*\d+\s*조(?:\s*의\s*\d+)?)(?:\s*(\([^)\n]*\)))?(?:\s+(.*))?$/u,
  );
  if (articleMatch) {
    const titleIndex = articleMatch[2]
      ? value.indexOf(articleMatch[2], articleMatch[1].length)
      : -1;
    const heading = articleMatch[2]
      ? value.slice(0, titleIndex + articleMatch[2].length).trim()
      : articleMatch[1].trim();
    return {
      kind: 'article',
      heading,
      inlineBody: articleMatch[3]?.trim() ?? '',
      leadingMetadata,
    };
  }

  const hierarchyMatch = value.match(/^(제\s*\d+\s*(편|장|절|관))(?:\s+.*)?$/u);
  if (hierarchyMatch) {
    const kindByUnit: Record<string, HierarchyKind> = {
      편: 'part',
      장: 'chapter',
      절: 'section',
      관: 'subsection',
    };
    return {
      kind: kindByUnit[hierarchyMatch[2]],
      heading: value,
      inlineBody: '',
      leadingMetadata,
    };
  }

  if (/^부칙(?=\s|$|\()/u.test(value)) {
    return { kind: 'addendum', heading: value, inlineBody: '', leadingMetadata };
  }
  if (/^별표(?:\s|$|\d)/u.test(value)) {
    return { kind: 'appendix', heading: value, inlineBody: '', leadingMetadata };
  }
  if (/^별지(?:\s|$|\d)/u.test(value)) {
    return { kind: 'form', heading: value, inlineBody: '', leadingMetadata };
  }

  return null;
}

function hierarchyPath(state: HierarchyState): string[] {
  return [state.part, state.chapter, state.section, state.subsection]
    .filter((value): value is string => Boolean(value));
}

function updateHierarchy(state: HierarchyState, kind: HierarchyKind, heading: string): void {
  if (kind === 'part') {
    state.part = heading;
    state.chapter = null;
    state.section = null;
    state.subsection = null;
  } else if (kind === 'chapter') {
    state.chapter = heading;
    state.section = null;
    state.subsection = null;
  } else if (kind === 'section') {
    state.section = heading;
    state.subsection = null;
  } else {
    state.subsection = heading;
  }
}

function blockHasSource(block: DocumentBlock): boolean {
  return block.kind === 'table'
    ? (block.rows?.length ?? 0) > 0
    : Boolean(block.text?.length);
}

function blockAsText(block: DocumentBlock): string {
  if (block.kind !== 'table') return block.text ?? '';
  return (block.rows ?? [])
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n');
}

function isMarkdownTableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/u.test(line);
}

function isMarkdownSeparatorLine(line: string): boolean {
  const cells = line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|');
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()));
}

function clonePattern(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags);
}

function splitAtPattern(text: string, pattern: RegExp): string[] {
  const indexes = [...text.matchAll(clonePattern(pattern))]
    .map((match) => match.index)
    .filter((index): index is number => index !== undefined && index > 0);
  if (indexes.length === 0) return [text];

  const pieces: string[] = [];
  let start = 0;
  for (const index of indexes) {
    pieces.push(text.slice(start, index));
    start = index;
  }
  pieces.push(text.slice(start));
  return pieces.filter(Boolean);
}

function splitLegalBody(
  text: string,
  maxLength: number,
  patternIndex: number = 0,
): string[] {
  if (!text || text.length <= maxLength) return text ? [text] : [];
  if (patternIndex >= paragraphPatterns.length) {
    return splitTextPreservingSeparators(text, maxLength);
  }

  const pieces = splitAtPattern(text, paragraphPatterns[patternIndex]);
  if (pieces.length === 1) {
    return splitLegalBody(text, maxLength, patternIndex + 1);
  }

  const refined = pieces.flatMap((piece) =>
    piece.length <= maxLength
      ? [piece]
      : splitLegalBody(piece, maxLength, patternIndex + 1));
  const chunks: string[] = [];
  let current = '';
  for (const piece of refined) {
    if (!current || current.length + piece.length <= maxLength) {
      current += piece;
    } else {
      chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function contextLines(fileName: string, location: string[]): string[] {
  return [
    `[문서] ${fileName}`,
    `[위치] ${location.length > 0 ? location.join(' > ') : '전문'}`,
  ];
}

function contextBodyLimit(context: string[]): number {
  return Math.max(1, APP_CHUNK_LIMIT - context.join('\n').length - 1);
}

function parseLawUnits(document: ExtractedDocument): LegalUnit[] {
  const units: LegalUnit[] = [];
  const hierarchy: HierarchyState = {
    part: null,
    chapter: null,
    section: null,
    subsection: null,
  };
  let specialRoot: string | null = null;
  let activeLocation: string[] = [];
  let bodyLines: string[] = [];
  let strongBoundaryPending = false;
  let tableIndex = 0;

  const flushText = (preserveEmptyBoundary: boolean = true): void => {
    const body = bodyLines.join('\n').trim();
    if (body || (preserveEmptyBoundary && strongBoundaryPending)) {
      units.push({
        kind: 'text',
        location: activeLocation.length > 0 ? [...activeLocation] : ['전문'],
        body,
      });
    }
    bodyLines = [];
    strongBoundaryPending = false;
  };

  const acceptHeading = (heading: ParsedLegalHeading): void => {
    flushText();
    if (
      heading.kind === 'part' ||
      heading.kind === 'chapter' ||
      heading.kind === 'section' ||
      heading.kind === 'subsection'
    ) {
      specialRoot = null;
      updateHierarchy(hierarchy, heading.kind, heading.heading);
      activeLocation = hierarchyPath(hierarchy);
      return;
    }

    if (heading.kind === 'article') {
      activeLocation = specialRoot
        ? [specialRoot, heading.heading]
        : [...hierarchyPath(hierarchy), heading.heading];
      strongBoundaryPending = true;
      const firstBody = [heading.leadingMetadata, heading.inlineBody]
        .filter(Boolean)
        .join(' ');
      if (firstBody) bodyLines.push(firstBody);
      return;
    }

    specialRoot = heading.heading;
    hierarchy.part = null;
    hierarchy.chapter = null;
    hierarchy.section = null;
    hierarchy.subsection = null;
    activeLocation = [heading.heading];
    strongBoundaryPending = true;
    if (heading.leadingMetadata) bodyLines.push(heading.leadingMetadata);
  };

  const acceptLines = (lines: string[], sourceId: string): void => {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (
        isMarkdownTableLine(line) &&
        index + 1 < lines.length &&
        isMarkdownSeparatorLine(lines[index + 1])
      ) {
        if (bodyLines.join('\n').trim()) {
          flushText();
        } else {
          strongBoundaryPending = false;
        }
        const tableLines: string[] = [];
        while (index < lines.length && isMarkdownTableLine(lines[index])) {
          tableLines.push(lines[index]);
          index += 1;
        }
        index -= 1;
        const [parsedTable] = extractMarkdownTableBlocks(
          tableLines.join('\n'),
          `${sourceId}-law-${++tableIndex}`,
        );
        if (parsedTable) {
          units.push({
            kind: 'table',
            location: activeLocation.length > 0 ? [...activeLocation] : ['전문'],
            block: parsedTable,
          });
        } else {
          bodyLines.push(...tableLines);
        }
        continue;
      }

      const heading = parseLegalHeading(line);
      if (heading) {
        acceptHeading(heading);
      } else {
        bodyLines.push(line);
      }
    }
  };

  for (const block of [...document.blocks].sort((left, right) => left.order - right.order)) {
    if (block.kind === 'table') {
      if (bodyLines.join('\n').trim()) {
        flushText();
      } else {
        strongBoundaryPending = false;
      }
      units.push({
        kind: 'table',
        location: block.headingPath.length > 0
          ? [...block.headingPath]
          : activeLocation.length > 0
            ? [...activeLocation]
            : ['전문'],
        block,
      });
      continue;
    }
    acceptLines((block.text ?? '').replace(/\r\n?/gu, '\n').split('\n'), block.id);
  }
  flushText();
  return units;
}

function assignOriginalSourceIds(
  document: ExtractedDocument,
  drafts: ChunkDraft[],
): string[] {
  const expectedSourceBlockIds = document.blocks
    .filter(blockHasSource)
    .map((block) => block.id);
  if (drafts.length > 0) {
    drafts.forEach((draft) => {
      draft.sourceBlockIds = [];
    });
    drafts[0].sourceBlockIds = [...expectedSourceBlockIds];
  }
  return expectedSourceBlockIds;
}

/**
 * Chunks statutes and internal regulations at strong legal boundaries while
 * retaining the complete hierarchy on every continuation.
 */
export function chunkLawDocument(document: ExtractedDocument): ChunkingOutput {
  const drafts: ChunkDraft[] = [];
  const warnings: PreprocessIssue[] = [...document.warnings];

  for (const unit of parseLawUnits(document)) {
    const context = contextLines(document.fileName, unit.location);
    if (unit.kind === 'table') {
      const tableOutput = chunkTableBlock(unit.block, context);
      drafts.push(...tableOutput.drafts);
      warnings.push(...tableOutput.warnings);
      continue;
    }

    const bodyLimit = contextBodyLimit(context);
    const bodies = unit.body ? splitLegalBody(unit.body, bodyLimit) : [''];
    for (const body of bodies) {
      drafts.push({
        body,
        contextLines: context,
        sourceBlockIds: [],
        warnings: [],
      });
    }
  }

  return {
    drafts,
    expectedSourceBlockIds: assignOriginalSourceIds(document, drafts),
    warnings,
  };
}

interface DelegationCategory {
  lineIndex: number;
  letter: string;
  title: string;
}

function delegationTableRange(lines: string[]): { start: number; end: number } | null {
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!isMarkdownTableLine(lines[index]) || !isMarkdownSeparatorLine(lines[index + 1])) {
      continue;
    }
    let end = index + 2;
    while (end < lines.length && isMarkdownTableLine(lines[end])) end += 1;
    return { start: index, end };
  }
  return null;
}

function pushDelegationTextDrafts(
  drafts: ChunkDraft[],
  prefix: string,
  text: string,
): void {
  const bodyLimit = Math.max(1, APP_CHUNK_LIMIT - prefix.length - 1);
  for (const piece of splitTextPreservingSeparators(text, bodyLimit)) {
    drafts.push({
      body: `${prefix}\n${piece}`.trim(),
      contextLines: [],
      sourceBlockIds: [],
      warnings: [],
    });
  }
}

function chunkDelegationCategory(
  title: string,
  bodyLines: string[],
  categoryIndex: number,
): { drafts: ChunkDraft[]; warnings: PreprocessIssue[] } {
  const prefix = `${DELEGATION_MANUAL_TITLE}\n${title}`;
  const tableRange = delegationTableRange(bodyLines);
  if (!tableRange) {
    const text = bodyLines.join('\n').trim();
    if (!text) {
      return {
        drafts: [{
          body: prefix,
          contextLines: [],
          sourceBlockIds: [],
          warnings: [],
        }],
        warnings: [],
      };
    }
    const drafts: ChunkDraft[] = [];
    pushDelegationTextDrafts(drafts, prefix, text);
    return { drafts, warnings: [] };
  }

  const before = bodyLines.slice(0, tableRange.start).join('\n').trim();
  const tableText = bodyLines.slice(tableRange.start, tableRange.end).join('\n');
  const after = bodyLines.slice(tableRange.end).join('\n').trim();
  const [tableBlock] = extractMarkdownTableBlocks(
    tableText,
    `delegation-${categoryIndex}`,
  );
  if (!tableBlock) {
    const drafts: ChunkDraft[] = [];
    pushDelegationTextDrafts(drafts, prefix, bodyLines.join('\n').trim());
    return { drafts, warnings: [] };
  }

  const tableContext = before ? [prefix, before] : [prefix];
  const tableOutput = chunkTableBlock(tableBlock, tableContext);
  const drafts = tableOutput.drafts.map((draft, index) => ({
    body: [
      prefix,
      index === 0 && before ? before : '',
      draft.body,
    ].filter(Boolean).join('\n'),
    contextLines: [],
    sourceBlockIds: [],
    warnings: [...draft.warnings],
  }));

  if (after) {
    const last = drafts.at(-1);
    if (last && last.body.length + after.length + 1 <= APP_CHUNK_LIMIT) {
      last.body += `\n${after}`;
    } else {
      pushDelegationTextDrafts(drafts, prefix, after);
    }
  }

  return { drafts, warnings: tableOutput.warnings };
}

/**
 * Preserves the legacy 위임전결 A-J category layout. Returns null unless the
 * distinctive title, sequential categories, and Markdown table are present.
 */
export function chunkDelegationManualDocument(
  document: ExtractedDocument,
): ChunkingOutput | null {
  const text = [...document.blocks]
    .sort((left, right) => left.order - right.order)
    .map(blockAsText)
    .filter(Boolean)
    .join('\n')
    .replace(/\r\n?/gu, '\n');
  const lines = text.split('\n');
  const manualTitleIndex = lines.findIndex(
    (line) => line.trim() === DELEGATION_MANUAL_TITLE,
  );
  if (manualTitleIndex < 0) return null;

  const categoryMarkers: DelegationCategory[] = [];
  for (let lineIndex = manualTitleIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const title = lines[lineIndex].trim();
    const match = title.match(DELEGATION_CATEGORY_PATTERN);
    if (match) categoryMarkers.push({ lineIndex, letter: match[1], title });
  }

  const hasSequentialCategories =
    categoryMarkers.length >= 2 &&
    categoryMarkers[0].letter === 'A' &&
    categoryMarkers.every((marker, index) =>
      index === 0 ||
      marker.letter.charCodeAt(0) ===
        categoryMarkers[index - 1].letter.charCodeAt(0) + 1);
  const hasMarkdownTable = lines
    .slice(manualTitleIndex + 1)
    .some((line, index, tail) =>
      isMarkdownTableLine(line) &&
      index + 1 < tail.length &&
      isMarkdownSeparatorLine(tail[index + 1]));
  if (!hasSequentialCategories || !hasMarkdownTable) return null;

  const drafts: ChunkDraft[] = [];
  const warnings: PreprocessIssue[] = [...document.warnings];
  const regulationText = lines.slice(0, manualTitleIndex).join('\n').trim();
  if (regulationText) {
    for (const body of splitTextPreservingSeparators(regulationText, APP_CHUNK_LIMIT)) {
      drafts.push({
        body,
        contextLines: [],
        sourceBlockIds: [],
        warnings: [],
      });
    }
  }

  categoryMarkers.forEach((marker, index) => {
    const nextMarker = categoryMarkers[index + 1];
    const category = chunkDelegationCategory(
      marker.title,
      lines.slice(marker.lineIndex + 1, nextMarker?.lineIndex ?? lines.length),
      index + 1,
    );
    drafts.push(...category.drafts);
    warnings.push(...category.warnings);
  });

  return {
    drafts,
    expectedSourceBlockIds: assignOriginalSourceIds(document, drafts),
    warnings,
  };
}
