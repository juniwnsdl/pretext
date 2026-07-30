import {
  APP_CHUNK_LIMIT,
  MISO_CHUNK_LIMIT,
  MISO_JOINER,
  MISO_SEPARATOR,
  type ChunkDraft,
  type DocumentBlock,
  type PreprocessIssue,
  type PreprocessResult,
  type ResultStatus,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './contracts.ts';

export interface PreparedSourceText {
  text: string;
  warnings: PreprocessIssue[];
}

export interface FinalizeChunkDraftsInput {
  originalLength: number;
  expectedSourceBlockIds: string[];
  drafts: ChunkDraft[];
  warnings?: PreprocessIssue[];
}

function issue(
  code: string,
  severity: PreprocessIssue['severity'],
  message: string,
  count?: number,
): PreprocessIssue {
  return { code, severity, message, ...(count === undefined ? {} : { count }) };
}

function isPageNumberLine(line: string): boolean {
  const value = line.trim();
  return /^(?:\d+\s*[-–—]\s*\d+|[-–—]\s*\d+\s*[-–—]|(?:page|페이지)\s*\d+(?:\s*(?:\/|of)\s*\d+)?)$/iu.test(value);
}

function isDecorationCandidate(line: string): boolean {
  const value = line.trim();
  if (value.length < 2 || value.length > 80 || isPageNumberLine(value)) return false;
  if (/^\|.*\|$/u.test(value) || /^(?:[-*+] |\d+[.)] |[•◦] )/u.test(value)) return false;
  return !/[.!?。！？]$/u.test(value);
}

function removeRepeatedPageDecorations(text: string): PreparedSourceText {
  const lines = text.split('\n');
  const nonEmpty = lines
    .map((line, lineIndex) => ({ lineIndex, value: line.trim().replace(/\s+/gu, ' ') }))
    .filter(({ value }) => value.length > 0);
  const pagePositions = nonEmpty
    .flatMap(({ value }, index) => isPageNumberLine(value) ? [index] : []);
  const positionsByValue = new Map<string, number[]>();

  nonEmpty.forEach(({ value }, index) => {
    const positions = positionsByValue.get(value) ?? [];
    positions.push(index);
    positionsByValue.set(value, positions);
  });

  // A header or footer block is contiguous with its page number line; body
  // text that merely repeats near a page boundary is separated from it by at
  // least one non-decoration line.
  const isEvidencedByPage = (position: number): boolean =>
    pagePositions.some((pagePosition) => {
      if (Math.abs(pagePosition - position) > 3) return false;
      const [low, high] = position < pagePosition
        ? [position, pagePosition]
        : [pagePosition, position];
      for (let between = low + 1; between < high; between += 1) {
        if (!isDecorationCandidate(nonEmpty[between].value)) return false;
      }
      return true;
    });

  const removableLineIndexes = new Set<number>();
  for (const [value, positions] of positionsByValue) {
    if (!isDecorationCandidate(value)) continue;
    const evidencedPositions = positions.filter(isEvidencedByPage);
    if (evidencedPositions.length < 2) continue;
    for (const position of evidencedPositions.slice(1)) {
      removableLineIndexes.add(nonEmpty[position].lineIndex);
    }
  }

  // Page number lines themselves are transport noise once pagination is evident.
  if (pagePositions.length >= 2) {
    for (const pagePosition of pagePositions) {
      removableLineIndexes.add(nonEmpty[pagePosition].lineIndex);
    }
  }

  if (removableLineIndexes.size === 0) return { text, warnings: [] };

  const filtered = lines.filter((_, lineIndex) => !removableLineIndexes.has(lineIndex));

  return {
    text: filtered.join('\n'),
    warnings: [issue('page-decoration-removed', 'warning', '반복되는 페이지 머리말·꼬리말을 제거했습니다.', removableLineIndexes.size)],
  };
}

/** Normalizes transport noise without changing meaningful indentation or repeated content. */
export function prepareSourceText(source: string): PreparedSourceText {
  const normalized = source
    .replace(/\r\n?/gu, '\n')
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/gu, '')
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/gu, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/gu, ''))
    .join('\n')
    .trimEnd();

  return removeRepeatedPageDecorations(normalized);
}

function takeCodePoints(text: string, limit: number): string {
  let result = '';
  for (const character of text) {
    if (result.length + character.length > limit) break;
    result += character;
  }
  return result;
}

function findPreferredBreak(text: string, limit: number): number | null {
  for (const separator of ['\n\n', '\n']) {
    const index = text.lastIndexOf(separator, limit - separator.length);
    if (index >= 0 && index + separator.length > 0) return index + separator.length;
  }

  const sentenceEndings = /[.!?。！？]+(?:\s+|$)/gu;
  let match: RegExpExecArray | null;
  let ending: number | null = null;
  while ((match = sentenceEndings.exec(text)) !== null) {
    const candidate = match.index + match[0].length;
    if (candidate > limit) break;
    ending = candidate;
  }
  if (ending !== null) return ending;

  const space = text.lastIndexOf(' ', limit - 1);
  return space >= 0 ? space + 1 : null;
}

/** Splits at the highest available boundary and keeps the consumed separator in output. */
export function splitTextPreservingSeparators(text: string, maxLength: number): string[] {
  if (maxLength < 1) return text ? [text] : [];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const preferredBreak = findPreferredBreak(remaining, maxLength);
    const chunk = preferredBreak === null
      ? takeCodePoints(remaining, maxLength)
      : remaining.slice(0, preferredBreak);
    if (!chunk) break;
    chunks.push(chunk);
    remaining = remaining.slice(chunk.length);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function replaceSourceSeparators(text: string): { text: string; count: number } {
  const count = text.split(MISO_SEPARATOR).length - 1;
  return { text: text.replaceAll(MISO_SEPARATOR, '＠＠＠'), count };
}

function renderDraft(contextLines: string[], body: string): { context: string; body: string } {
  const context = contextLines.join('\n');
  return { context, body };
}

function validateSourceBlockIds(
  expectedSourceBlockIds: string[],
  drafts: ChunkDraft[],
  issues: PreprocessIssue[],
): void {
  const countIds = (ids: string[]): Map<string, number> => ids.reduce((counts, id) => {
    counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const expected = countIds(expectedSourceBlockIds);
  const consumed = countIds(drafts.flatMap((draft) => draft.sourceBlockIds));
  const ids = new Set([...expected.keys(), ...consumed.keys()]);
  const mismatches = [...ids].filter((id) => {
    const expectedCount = expected.get(id) ?? 0;
    const consumedCount = consumed.get(id) ?? 0;
    return expectedCount !== consumedCount || expectedCount > 1 || consumedCount > 1;
  });
  if (mismatches.length > 0) {
    issues.push(issue('source-block-consumption-mismatch', 'error', 'Chunk drafts do not consume the expected source blocks.', mismatches.length));
  }
}

function resultFromChunks(
  chunks: string[],
  originalLength: number,
  issues: PreprocessIssue[],
  sourceSeparatorCollisionCount: number,
): PreprocessResult {
  const emptyChunkCount = chunks.filter((chunk) => chunk.trim().length === 0).length;
  const safeLimitExceededCount = chunks.filter((chunk) => chunk.length > APP_CHUNK_LIMIT).length;
  const misoLimitExceededCount = chunks.filter((chunk) => chunk.length > MISO_CHUNK_LIMIT).length;
  const unresolvedSeparatorCollisionCount = chunks.filter((chunk) => chunk.includes(MISO_SEPARATOR)).length;

  if (chunks.length === 0) issues.push(issue('empty-result', 'error', 'No chunks were produced.'));
  if (emptyChunkCount > 0) issues.push(issue('empty-chunk', 'error', 'One or more chunks are empty.', emptyChunkCount));
  if (safeLimitExceededCount > 0) issues.push(issue('safe-limit-exceeded', 'error', 'One or more chunks exceed the application safety limit.', safeLimitExceededCount));
  if (misoLimitExceededCount > 0) issues.push(issue('miso-limit-exceeded', 'error', 'One or more chunks exceed the MISO limit.', misoLimitExceededCount));
  if (unresolvedSeparatorCollisionCount > 0) issues.push(issue('unresolved-separator-collision', 'error', 'A chunk still contains the MISO separator.', unresolvedSeparatorCollisionCount));
  if (sourceSeparatorCollisionCount > 0) issues.push(issue('source-separator-replaced', 'warning', '원문에 포함된 MISO 구분자(@@@)를 다른 문자로 바꿨습니다.', sourceSeparatorCollisionCount));

  const processedText = serializeMisoChunks(chunks);
  const resultStatus: ResultStatus = issues.some((entry) => entry.severity === 'error')
    ? 'blocked'
    : issues.length > 0
      ? 'review'
      : 'ready';

  return {
    processedText,
    chunks,
    stats: {
      originalLength,
      processedLength: processedText.length,
      chunkCount: chunks.length,
      longestChunkLength: chunks.reduce((longest, chunk) => Math.max(longest, chunk.length), 0),
      safeLimitExceededCount,
      misoLimitExceededCount,
      sourceSeparatorCollisionCount,
      unresolvedSeparatorCollisionCount,
      emptyChunkCount,
    },
    issues,
    resultStatus,
    canDownload: resultStatus !== 'blocked',
  };
}

/** The sole serialization format accepted by MISO. */
export function serializeMisoChunks(chunks: string[]): string {
  return chunks.join(MISO_JOINER);
}

/**
 * Assigns 1-based ordinals to consecutive ordered list items per depth so
 * renderers can restore real numbering instead of stamping every item "1.".
 */
export function orderedListOrdinals(blocks: DocumentBlock[]): Map<string, number> {
  const ordinals = new Map<string, number>();
  const counters = new Map<number, number>();
  for (const block of [...blocks].sort((left, right) => left.order - right.order)) {
    if (block.kind !== 'list-item') {
      counters.clear();
      continue;
    }
    const depth = Math.max(0, block.depth ?? 0);
    for (const key of [...counters.keys()]) {
      if (key > depth) counters.delete(key);
    }
    if (!block.ordered) {
      counters.delete(depth);
      continue;
    }
    const ordinal = (counters.get(depth) ?? 0) + 1;
    counters.set(depth, ordinal);
    ordinals.set(block.id, ordinal);
  }
  return ordinals;
}

/** Applies final delimiter escaping, source tracking, splitting, and safety validation. */
export function finalizeChunkDrafts(input: FinalizeChunkDraftsInput): PreprocessResult {
  const issues = [
    ...(input.warnings ?? []),
    ...input.drafts.flatMap((draft) => draft.warnings),
  ];
  validateSourceBlockIds(input.expectedSourceBlockIds, input.drafts, issues);

  const chunks: string[] = [];
  let sourceSeparatorCollisionCount = 0;
  for (const draft of input.drafts) {
    const context = replaceSourceSeparators(renderDraft(draft.contextLines, draft.body).context);
    const body = replaceSourceSeparators(draft.body);
    sourceSeparatorCollisionCount += context.count + body.count;
    const prefix = context.text ? `${context.text}\n` : '';
    const rendered = `${prefix}${body.text}`;

    if (rendered.length <= APP_CHUNK_LIMIT) {
      chunks.push(rendered);
      continue;
    }

    const bodyLimit = APP_CHUNK_LIMIT - prefix.length;
    if (bodyLimit < 1) {
      chunks.push(rendered);
      continue;
    }
    for (const bodyChunk of splitTextPreservingSeparators(body.text, bodyLimit)) {
      chunks.push(`${prefix}${bodyChunk}`);
    }
  }

  return resultFromChunks(chunks, input.originalLength, issues, sourceSeparatorCollisionCount);
}

/** Validates user-edited chunks without silently re-splitting their edits. */
export function revalidateEditedChunks(chunks: string[], originalLength: number): PreprocessResult {
  let sourceSeparatorCollisionCount = 0;
  const sanitized = chunks.map((chunk) => {
    const replacement = replaceSourceSeparators(chunk);
    sourceSeparatorCollisionCount += replacement.count;
    return replacement.text;
  });
  return resultFromChunks(sanitized, originalLength, [], sourceSeparatorCollisionCount);
}
