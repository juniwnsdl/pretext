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

interface LocationEntry {
  text: string;
  sourceId: string;
}

interface HierarchyState {
  part: LocationEntry | null;
  chapter: LocationEntry | null;
  section: LocationEntry | null;
  subsection: LocationEntry | null;
}

export interface ParsedLegalHeading {
  kind: HierarchyKind | 'article' | 'addendum' | 'appendix' | 'form';
  heading: string;
  inlineBody: string;
  leadingMetadata: string;
}

interface TextUnit {
  kind: 'text';
  location: string[];
  body: string;
  sourceBlockIds: string[];
}

interface TableUnit {
  kind: 'table';
  location: string[];
  block: DocumentBlock;
  sourceBlockIds: string[];
}

interface SourcedLine {
  text: string;
  sourceId: string;
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

function hasExplicitMarkdownHeadingSyntax(line: string): boolean {
  const value = line.trim();
  return /^#{1,6}\s+/u.test(value) ||
    /^(?:\*\*.*\*\*|__.*__|~~.*~~|`.*`)$/u.test(value);
}

function isImmediateLegalCitationSuffix(value: string): boolean {
  if (!value || /^\s/u.test(value)) return false;
  return [
    /^에\s*(?:따(?:르|른|라)|의(?:하|한|해)|관(?:하|한|해)|근거|의거|규정|명시|해당)/u,
    /^에서\s*(?:정(?:하|한|해)|규정(?:하|한|해|되|된)|명시(?:하|한|해|되|된))/u,
    /^의\s*(?:규정|내용|적용|취지)/u,
    /^[을를]\s*(?:적용|준용|인용|참조)/u,
    /^[과와]\s*(?:관련|관계)/u,
  ].some((pattern) => pattern.test(value));
}

/** True when text after a legal keyword continues a citation ("및 제13조…", "제2항의 규정…"). */
function isCitationContinuation(value: string): boolean {
  const trimmed = value.trimStart();
  if (!trimmed) return false;
  if (isImmediateLegalCitationSuffix(trimmed)) return true;
  return /^(?:및|또는|내지|부터|까지)(?:\s|$)/u.test(trimmed) ||
    /^제\s*\d+\s*[항호]/u.test(trimmed);
}

function isSentenceLikeText(value: string): boolean {
  return /(?:다|시오|세요|에요|예요|해요|아요|어요|네요|지요|죠)(?:[.!?。！？])?$/u.test(value.trim());
}

/** True for table-of-contents tails such as "·········· 12". */
function isTocLeaderTail(value: string): boolean {
  const trimmed = value.trim();
  return /^[·.…‥\-\s]*\d{1,4}$/u.test(trimmed) && /[·…‥]|\.{2,}/u.test(trimmed);
}

export function parseLegalHeading(line: string): ParsedLegalHeading | null {
  const trimmed = stripMarkdownHeading(line);
  if (!trimmed) return null;

  const metadataMatch = trimmed.match(
    /^((?:(?:\d+\.)+\s*)?(?:\[(?:\d+\.)+\]\s*)?)(?=제\s*\d+)/u,
  );
  const leadingMetadata = metadataMatch?.[1].trim() ?? '';
  const value = leadingMetadata
    ? trimmed.slice(metadataMatch?.[1].length ?? 0).trim()
    : trimmed;

  const titledArticleMatch = value.match(
    /^(제\s*\d+\s*조(?:\s*의\s*\d+)?)\s*(\([^)\n]*\))(.*)$/u,
  );
  if (titledArticleMatch && (
    isImmediateLegalCitationSuffix(titledArticleMatch[3]) ||
    isCitationContinuation(titledArticleMatch[3]) ||
    isTocLeaderTail(titledArticleMatch[3])
  )) {
    return null;
  }
  const untitledArticleMatch = titledArticleMatch
    ? null
    : value.match(/^(제\s*\d+\s*조(?:\s*의\s*\d+)?)(?:\s+(.*))?$/u);
  if (untitledArticleMatch?.[2] && (
    isCitationContinuation(untitledArticleMatch[2]) ||
    isTocLeaderTail(untitledArticleMatch[2])
  )) {
    return null;
  }
  if (titledArticleMatch || untitledArticleMatch) {
    const articleMatch = titledArticleMatch ?? untitledArticleMatch;
    const title = titledArticleMatch?.[2];
    const titleIndex = title
      ? value.indexOf(title, articleMatch?.[1].length ?? 0)
      : -1;
    const heading = title
      ? value.slice(0, titleIndex + title.length).trim()
      : articleMatch?.[1].trim() ?? '';
    return {
      kind: 'article',
      heading,
      inlineBody: (titledArticleMatch?.[3] ?? untitledArticleMatch?.[2] ?? '').trim(),
      leadingMetadata,
    };
  }

  const hierarchyMatch = value.match(/^(제\s*\d+\s*(편|장|절|관))(?:\s+(.+))?$/u);
  if (hierarchyMatch) {
    let title = hierarchyMatch[3]?.trim() ?? '';
    if (isCitationContinuation(title)) return null;
    if (!hasExplicitMarkdownHeadingSyntax(line) && isSentenceLikeText(title)) return null;
    const leaderTail = title.match(/^(.*?)\s*(?:[·…‥]|\.{2,})[·.…‥\s]*\d{1,4}$/u);
    if (leaderTail) title = leaderTail[1].trim();

    const kindByUnit: Record<string, HierarchyKind> = {
      편: 'part',
      장: 'chapter',
      절: 'section',
      관: 'subsection',
    };
    return {
      kind: kindByUnit[hierarchyMatch[2]],
      heading: title ? `${hierarchyMatch[1]} ${title}` : hierarchyMatch[1],
      inlineBody: '',
      leadingMetadata,
    };
  }

  const addendumMatch = value.match(/^부\s?칙(?=\s|$|\()/u);
  if (addendumMatch) {
    const rest = value.slice(addendumMatch[0].length).trim();
    if (!isSentenceLikeText(rest) && !isCitationContinuation(rest) && !isTocLeaderTail(rest)) {
      return { kind: 'addendum', heading: value, inlineBody: '', leadingMetadata };
    }
  }
  const appendixMatch = value.match(/^(별표|별지)(?=\s|$|\d)\s*(?:제\s*)?\d*(?:호|의\s*\d+)?/u);
  if (appendixMatch) {
    const rest = value.slice(appendixMatch[0].length).trim();
    if (
      !isImmediateLegalCitationSuffix(value.slice(appendixMatch[0].length)) &&
      !isCitationContinuation(rest) &&
      !isSentenceLikeText(rest) &&
      !isTocLeaderTail(rest)
    ) {
      return {
        kind: appendixMatch[1] === '별표' ? 'appendix' : 'form',
        heading: value,
        inlineBody: '',
        leadingMetadata,
      };
    }
  }

  return null;
}

function hierarchyPath(state: HierarchyState): LocationEntry[] {
  return [state.part, state.chapter, state.section, state.subsection]
    .filter((value): value is LocationEntry => Boolean(value));
}

function updateHierarchy(
  state: HierarchyState,
  kind: HierarchyKind,
  heading: LocationEntry,
): void {
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
  const rows = block.rows ?? [];
  if (rows.length === 0) return '';
  const header = `| ${rows[0].join(' | ')} |`;
  const separator = `| ${rows[0].map(() => '---').join(' | ')} |`;
  return [header, separator, ...rows.slice(1).map((row) =>
    `| ${row.join(' | ')} |`)].join('\n');
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

function claimSourceIds(candidates: string[], claimed: Set<string>): string[] {
  const result: string[] = [];
  for (const sourceId of candidates) {
    if (!sourceId || claimed.has(sourceId)) continue;
    claimed.add(sourceId);
    result.push(sourceId);
  }
  return result;
}

function expectedSourceBlockIds(document: ExtractedDocument): string[] {
  return document.blocks.filter(blockHasSource).map((block) => block.id);
}

function parseLawUnits(document: ExtractedDocument): LegalUnit[] {
  const units: LegalUnit[] = [];
  const claimedSourceIds = new Set<string>();
  const hierarchy: HierarchyState = {
    part: null,
    chapter: null,
    section: null,
    subsection: null,
  };
  let specialRoot: LocationEntry | null = null;
  let activeLocation: LocationEntry[] = [];
  let bodyLines: SourcedLine[] = [];
  let strongBoundaryPending = false;
  let tableIndex = 0;

  const flushText = (preserveEmptyBoundary: boolean = true): void => {
    const body = bodyLines.map((line) => line.text).join('\n');
    const hasBody = bodyLines.some((line) => line.text.length > 0);
    if (hasBody || (preserveEmptyBoundary && strongBoundaryPending)) {
      units.push({
        kind: 'text',
        location: activeLocation.length > 0
          ? activeLocation.map((entry) => entry.text)
          : ['전문'],
        body,
        sourceBlockIds: claimSourceIds([
          ...activeLocation.map((entry) => entry.sourceId),
          ...bodyLines.map((line) => line.sourceId),
        ], claimedSourceIds),
      });
    }
    bodyLines = [];
    strongBoundaryPending = false;
  };

  const acceptHeading = (heading: ParsedLegalHeading, sourceId: string): void => {
    flushText();
    if (
      heading.kind === 'part' ||
      heading.kind === 'chapter' ||
      heading.kind === 'section' ||
      heading.kind === 'subsection'
    ) {
      specialRoot = null;
      updateHierarchy(hierarchy, heading.kind, { text: heading.heading, sourceId });
      activeLocation = hierarchyPath(hierarchy);
      return;
    }

    if (heading.kind === 'article') {
      const article = { text: heading.heading, sourceId };
      activeLocation = specialRoot
        ? [specialRoot, article]
        : [...hierarchyPath(hierarchy), article];
      strongBoundaryPending = true;
      const firstBody = [heading.leadingMetadata, heading.inlineBody]
        .filter(Boolean)
        .join(' ');
      if (firstBody) bodyLines.push({ text: firstBody, sourceId });
      return;
    }

    specialRoot = { text: heading.heading, sourceId };
    hierarchy.part = null;
    hierarchy.chapter = null;
    hierarchy.section = null;
    hierarchy.subsection = null;
    activeLocation = [specialRoot];
    strongBoundaryPending = true;
    if (heading.leadingMetadata) {
      bodyLines.push({ text: heading.leadingMetadata, sourceId });
    }
  };

  const acceptLines = (lines: string[], sourceId: string): void => {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (
        isMarkdownTableLine(line) &&
        index + 1 < lines.length &&
        isMarkdownSeparatorLine(lines[index + 1])
      ) {
        if (bodyLines.some((entry) => entry.text.trim().length > 0)) {
          flushText();
        } else {
          bodyLines = [];
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
            location: activeLocation.length > 0
              ? activeLocation.map((entry) => entry.text)
              : ['전문'],
            block: parsedTable,
            sourceBlockIds: claimSourceIds([
              ...activeLocation.map((entry) => entry.sourceId),
              sourceId,
            ], claimedSourceIds),
          });
        } else {
          bodyLines.push(...tableLines.map((text) => ({ text, sourceId })));
        }
        continue;
      }

      const heading = parseLegalHeading(line);
      if (heading) {
        acceptHeading(heading, sourceId);
      } else {
        bodyLines.push({ text: line, sourceId });
      }
    }
  };

  for (const block of [...document.blocks].sort((left, right) => left.order - right.order)) {
    if (block.kind === 'table') {
      if (bodyLines.some((entry) => entry.text.trim().length > 0)) {
        flushText();
      } else {
        bodyLines = [];
        strongBoundaryPending = false;
      }
      const tableLocation = block.headingPath.length > 0
        ? block.headingPath.map((text) => ({ text, sourceId: block.id }))
        : activeLocation;
      units.push({
        kind: 'table',
        location: tableLocation.length > 0
          ? tableLocation.map((entry) => entry.text)
          : ['전문'],
        block,
        sourceBlockIds: claimSourceIds([
          ...tableLocation.map((entry) => entry.sourceId),
          block.id,
        ], claimedSourceIds),
      });
      continue;
    }
    acceptLines((block.text ?? '').replace(/\r\n?/gu, '\n').split('\n'), block.id);
  }
  flushText();
  return units;
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
      drafts.push(...tableOutput.drafts.map((draft, index) => ({
        ...draft,
        sourceBlockIds: index === 0 ? [...unit.sourceBlockIds] : [],
      })));
      warnings.push(...tableOutput.warnings);
      continue;
    }

    const bodyLimit = contextBodyLimit(context);
    const bodies = unit.body ? splitLegalBody(unit.body, bodyLimit) : [''];
    bodies.forEach((body, index) => {
      drafts.push({
        body,
        contextLines: context,
        sourceBlockIds: index === 0 ? [...unit.sourceBlockIds] : [],
        warnings: [],
      });
    });
  }

  // A heading-only boundary whose location reappears in the next draft's
  // location adds no content of its own; fold it into that draft instead of
  // emitting a context-only chunk.
  for (let index = drafts.length - 2; index >= 0; index -= 1) {
    const draft = drafts[index];
    const next = drafts[index + 1];
    const location = draft.contextLines[1];
    const nextLocation = next.contextLines[1];
    if (
      draft.body.trim().length === 0 &&
      location !== undefined &&
      nextLocation !== undefined &&
      (nextLocation === location || nextLocation.startsWith(`${location} > `))
    ) {
      next.sourceBlockIds = [...draft.sourceBlockIds, ...next.sourceBlockIds];
      drafts.splice(index, 1);
    }
  }

  // Table-of-contents entries parse as headings with no body; when the same
  // heading recurs later with real content, fold the empty draft into it.
  for (let index = drafts.length - 1; index >= 0; index -= 1) {
    const draft = drafts[index];
    if (draft.body.trim().length > 0) continue;
    const location = draft.contextLines[1]?.replace(/^\[위치\] /u, '');
    if (location === undefined) continue;
    const leaf = location.split(' > ').at(-1);
    const target = drafts.find((candidate, candidateIndex) => {
      if (candidateIndex <= index || candidate.body.trim().length === 0) return false;
      const candidateLocation = candidate.contextLines[1]?.replace(/^\[위치\] /u, '');
      return candidateLocation !== undefined &&
        (candidateLocation === location || candidateLocation.endsWith(` > ${leaf}`));
    });
    if (target) {
      target.sourceBlockIds = [...draft.sourceBlockIds, ...target.sourceBlockIds];
      drafts.splice(index, 1);
    }
  }

  return {
    drafts,
    expectedSourceBlockIds: expectedSourceBlockIds(document),
    warnings,
  };
}

interface DelegationCategory {
  lineIndex: number;
  letter: string;
  title: string;
  sourceId: string;
}

type DelegationSegment = {
  kind: 'text' | 'table';
  lines: SourcedLine[];
};

function documentAsSourcedLines(document: ExtractedDocument): SourcedLine[] {
  return [...document.blocks]
    .sort((left, right) => left.order - right.order)
    .flatMap((block) => {
      const text = blockAsText(block).replace(/\r\n?/gu, '\n');
      return text ? text.split('\n').map((line) => ({ text: line, sourceId: block.id })) : [];
    });
}

function splitSourcedLines(
  lines: SourcedLine[],
  maxLength: number,
): Array<{ body: string; sourceIds: string[] }> {
  const spans: Array<{ start: number; end: number; sourceId: string }> = [];
  let text = '';
  lines.forEach((line, index) => {
    if (index > 0) text += '\n';
    const start = text.length;
    text += line.text;
    spans.push({ start, end: text.length, sourceId: line.sourceId });
  });

  let offset = 0;
  return splitTextPreservingSeparators(text, maxLength).map((body) => {
    const start = offset;
    const end = start + body.length;
    offset = end;
    return {
      body,
      sourceIds: [...new Set(spans
        .filter((span) => span.start < end && span.end > start)
        .map((span) => span.sourceId))],
    };
  });
}

function delegationSegments(lines: SourcedLine[]): DelegationSegment[] {
  const segments: DelegationSegment[] = [];
  let textLines: SourcedLine[] = [];
  const flushText = (): void => {
    if (textLines.length > 0) segments.push({ kind: 'text', lines: textLines });
    textLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    if (
      isMarkdownTableLine(lines[index].text) &&
      index + 1 < lines.length &&
      isMarkdownSeparatorLine(lines[index + 1].text)
    ) {
      flushText();
      const tableLines: SourcedLine[] = [];
      while (index < lines.length && isMarkdownTableLine(lines[index].text)) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      segments.push({ kind: 'table', lines: tableLines });
    } else {
      textLines.push(lines[index]);
    }
  }
  flushText();
  return segments;
}

function chunkDelegationCategory(
  title: string,
  bodyLines: SourcedLine[],
  categoryIndex: number,
  prefixSourceIds: string[],
  claimedSourceIds: Set<string>,
): { drafts: ChunkDraft[]; warnings: PreprocessIssue[] } {
  const prefix = `${DELEGATION_MANUAL_TITLE}\n${title}`;
  const bodyLimit = Math.max(1, APP_CHUNK_LIMIT - prefix.length - 1);
  const drafts: ChunkDraft[] = [];
  const warnings: PreprocessIssue[] = [];
  let tableNumber = 0;

  const appendPiece = (body: string, candidateSourceIds: string[]): void => {
    if (!body) return;
    const last = drafts.at(-1);
    const pieceSourceIds = claimSourceIds(candidateSourceIds, claimedSourceIds);
    if (last && last.body.length + body.length + 1 <= APP_CHUNK_LIMIT) {
      last.body += `\n${body}`;
      last.sourceBlockIds.push(...pieceSourceIds);
      return;
    }
    drafts.push({
      body: `${prefix}\n${body}`,
      contextLines: [],
      sourceBlockIds: [
        ...claimSourceIds(prefixSourceIds, claimedSourceIds),
        ...pieceSourceIds,
      ],
      warnings: [],
    });
  };

  for (const segment of delegationSegments(bodyLines)) {
    if (segment.kind === 'text') {
      for (const piece of splitSourcedLines(segment.lines, bodyLimit)) {
        appendPiece(piece.body, piece.sourceIds);
      }
      continue;
    }

    const [tableBlock] = extractMarkdownTableBlocks(
      segment.lines.map((line) => line.text).join('\n'),
      `delegation-${categoryIndex}-${++tableNumber}`,
    );
    if (!tableBlock) {
      for (const piece of splitSourcedLines(segment.lines, bodyLimit)) {
        appendPiece(piece.body, piece.sourceIds);
      }
      continue;
    }
    const tableOutput = chunkTableBlock(tableBlock, [prefix]);
    warnings.push(...tableOutput.warnings);
    const tableSourceIds = [...new Set(segment.lines.map((line) => line.sourceId))];
    tableOutput.drafts.forEach((draft, index) => {
      appendPiece(draft.body, index === 0 ? tableSourceIds : []);
    });
  }

  if (drafts.length === 0) {
    drafts.push({
      body: prefix,
      contextLines: [],
      sourceBlockIds: claimSourceIds(prefixSourceIds, claimedSourceIds),
      warnings: [],
    });
  }
  return { drafts, warnings };
}

/**
 * Preserves the legacy 위임전결 A-J category layout. Returns null unless the
 * distinctive title, sequential categories, and Markdown table are present.
 */
export function chunkDelegationManualDocument(
  document: ExtractedDocument,
): ChunkingOutput | null {
  const sourcedLines = documentAsSourcedLines(document);
  const lines = sourcedLines.map((line) => line.text);
  const manualTitleIndex = lines.findIndex(
    (line) => line.trim() === DELEGATION_MANUAL_TITLE,
  );
  if (manualTitleIndex < 0) return null;

  const categoryMarkers: DelegationCategory[] = [];
  for (let lineIndex = manualTitleIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const title = lines[lineIndex].trim();
    const match = title.match(DELEGATION_CATEGORY_PATTERN);
    if (match) {
      categoryMarkers.push({
        lineIndex,
        letter: match[1],
        title,
        sourceId: sourcedLines[lineIndex].sourceId,
      });
    }
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
  const claimedSourceIds = new Set<string>();
  for (const piece of splitSourcedLines(
    sourcedLines.slice(0, manualTitleIndex),
    APP_CHUNK_LIMIT,
  )) {
    if (piece.body) {
      drafts.push({
        body: piece.body,
        contextLines: [],
        sourceBlockIds: claimSourceIds(piece.sourceIds, claimedSourceIds),
        warnings: [],
      });
    }
  }

  // Lines between the manual title and the first category (legend, revision
  // notes) are content: keep them under the manual title.
  const introLines = sourcedLines.slice(manualTitleIndex + 1, categoryMarkers[0].lineIndex);
  if (introLines.some((line) => line.text.trim().length > 0)) {
    const introLimit = Math.max(1, APP_CHUNK_LIMIT - DELEGATION_MANUAL_TITLE.length - 1);
    for (const piece of splitSourcedLines(introLines, introLimit)) {
      if (!piece.body.trim()) continue;
      drafts.push({
        body: `${DELEGATION_MANUAL_TITLE}\n${piece.body}`,
        contextLines: [],
        sourceBlockIds: claimSourceIds(
          [sourcedLines[manualTitleIndex].sourceId, ...piece.sourceIds],
          claimedSourceIds,
        ),
        warnings: [],
      });
    }
  }

  categoryMarkers.forEach((marker, index) => {
    const nextMarker = categoryMarkers[index + 1];
    const category = chunkDelegationCategory(
      marker.title,
      sourcedLines.slice(marker.lineIndex + 1, nextMarker?.lineIndex ?? lines.length),
      index + 1,
      [sourcedLines[manualTitleIndex].sourceId, marker.sourceId],
      claimedSourceIds,
    );
    drafts.push(...category.drafts);
    warnings.push(...category.warnings);
  });

  return {
    drafts,
    expectedSourceBlockIds: expectedSourceBlockIds(document),
    warnings,
  };
}
