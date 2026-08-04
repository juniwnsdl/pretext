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
  orderedListOrdinals,
  splitTextPreservingSeparators,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './core.ts';
import {
  chunkTableBlock,
  extractMarkdownTableBlocks,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './table-chunker.ts';

type ManualLineKind = 'section' | 'step' | 'safety' | 'paragraph';

interface TextUnit {
  kind: 'text';
  role: 'step' | 'instruction' | 'orphan-safety';
  text: string;
  sourceIds: string[];
  safetyPrefix?: string;
  safetySuffix?: string;
}

interface TableUnit {
  kind: 'table';
  block: DocumentBlock;
  sourceIds: string[];
  safetyLines?: string[];
}

type ManualUnit = TextUnit | TableUnit;

interface ManualSection {
  path: string[];
  headingSourceIds: string[];
  units: ManualUnit[];
  pendingSafety: Array<{ text: string; sourceId: string }>;
  warnings: PreprocessIssue[];
}

const safetyLabel = /^(?:\[\s*(?:주의|경고|위험|안전|중요|필독)\s*\]|(?:주의|경고|위험|안전|중요|필독)\s*[:：]|※)/u;
const numberedPrefix = /^\s*(?:\d+\.\s+|\d+\)\s+|\d+-\d+\s+|\d+\s+|[가-힣]\)\s+|[①-⑳]\s*|Step\s*\d+(?:\s*[:.)-])?\s+|단계\s*\d+(?:\s*[:.)-])?\s+)/iu;
const imperativeEnding = /(?:다|시오|세요)\.\s*$/u;
const dotlessSentenceEnding = /(?:한다|했다|하시오|하십시오|하세요|합니다|됩니다|이다|있습니다|없습니다|할\s+것|해야\s+함|바람|요망)\s*$/u;
const safetyCommandEnding = /(?:금지|(?:작업|운전|작동)\s*중지)(?:한다|합니다|하시오|하십시오)?\s*[).]?\s*$/u;
const knownSectionTitle = /^(?:(?:작업\s*)?개요|목적|범위|준비(?:\s*사항)?|절차|작업\s*절차|점검(?:\s*사항)?|기동|운전|종료|주의(?:\s*사항)?|안전\s*수칙)(?:입니다)?\.?\s*$/u;

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isMarkdownTableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/u.test(line);
}

function isMarkdownSeparatorLine(line: string): boolean {
  const cells = line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|');
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()));
}

/** Classifies raw-text manual lines without changing their meaningful whitespace. */
export function classifyManualLine(line: string): ManualLineKind {
  const trimmed = line.trim();
  if (!trimmed) return 'paragraph';
  if (safetyLabel.test(trimmed)) return 'safety';
  if (safetyCommandEnding.test(trimmed)) return 'step';
  if (/^#{1,6}\s+\S/u.test(trimmed)) return 'section';
  if (knownSectionTitle.test(trimmed)) return 'section';
  const numbered = trimmed.match(numberedPrefix);
  if (numbered) {
    if (knownSectionTitle.test(trimmed.slice(numbered[0].length).trim())) return 'section';
    if (imperativeEnding.test(trimmed)) return 'step';
    // A section title fits on a short line; long numbered prose is body.
    return trimmed.length <= 80 ? 'section' : 'paragraph';
  }
  return 'paragraph';
}

function hasSource(block: DocumentBlock): boolean {
  return block.kind === 'table'
    ? (block.rows?.length ?? 0) > 0
    : Boolean(block.text?.length);
}

function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sectionContext(fileName: string, path: string[]): string[] {
  return [
    `[문서] ${fileName}`,
    `[섹션] ${path.length > 0 ? path.join(' > ') : '전체'}`,
  ];
}

function bodyLimit(contextLines: string[]): number {
  return Math.max(1, APP_CHUNK_LIMIT - contextLines.join('\n').length - 1);
}

function headingPathForBlock(block: DocumentBlock): string[] {
  const text = block.text ?? '';
  if (!text) return [...block.headingPath];
  return block.headingPath.at(-1) === text
    ? [...block.headingPath]
    : [...block.headingPath, text];
}

function appendText(
  section: ManualSection,
  text: string,
  sourceIds: string[],
  role: TextUnit['role'] = 'instruction',
  safetyPrefix?: string,
): void {
  const previous = section.units.at(-1);
  if (
    previous?.kind === 'text' &&
    previous.role === 'instruction' &&
    role === 'instruction' &&
    previous.sourceIds.length === 1 &&
    sourceIds.length === 1 &&
    previous.sourceIds[0] === sourceIds[0]
  ) {
    previous.text += `\n${text}`;
    return;
  }
  section.units.push({ kind: 'text', role, text, sourceIds: unique(sourceIds), safetyPrefix });
}

function pendingSafetyText(section: ManualSection): string {
  return section.pendingSafety.map((entry) => entry.text).join('\n');
}

function pendingSafetySourceIds(section: ManualSection): string[] {
  return section.pendingSafety.map((entry) => entry.sourceId);
}

function appendUnpairedSafety(section: ManualSection): void {
  if (section.pendingSafety.length === 0) return;
  const text = pendingSafetyText(section);
  const sourceIds = pendingSafetySourceIds(section);

  // A label that trails a table annotates that table; frame the table with it
  // instead of reporting an orphan.
  for (let index = section.units.length - 1; index >= 0; index -= 1) {
    const unit = section.units[index];
    if (unit.kind === 'text' && unit.text.trim().length === 0) continue;
    if (unit.kind === 'table') {
      unit.safetyLines = [...(unit.safetyLines ?? []), ...section.pendingSafety.map((entry) => entry.text)];
      unit.sourceIds = unique([...unit.sourceIds, ...sourceIds]);
      section.pendingSafety = [];
      return;
    }
    break;
  }

  // In a safety-rules section (안전 수칙, 주의 사항, …) bare labels are the
  // section's content, not orphans awaiting a step.
  if (section.path.some((entry) => /안전|주의|수칙|경고|위험/u.test(entry))) {
    appendText(section, text, sourceIds, 'instruction');
    section.pendingSafety = [];
    return;
  }
  // A label without an adjacent instruction is still content; keep it and
  // surface a review warning instead of blocking the whole document.
  appendText(section, text, sourceIds, 'instruction');
  section.warnings.push({
    code: 'manual-safety-without-adjacent-instruction',
    severity: 'warning',
    message: `Safety label has no adjacent instruction: ${text}`,
    locations: unique(sourceIds),
  });
  section.pendingSafety = [];
}

function appendPendingSafetyToInstruction(
  section: ManualSection,
  text: string,
  sourceId: string,
  role: 'step' | 'instruction',
): void {
  const prefix = pendingSafetyText(section);
  const sourceIds = unique([...pendingSafetySourceIds(section), sourceId]);
  section.pendingSafety = [];
  appendText(
    section,
    prefix ? `${prefix}\n${text}` : text,
    sourceIds,
    role,
    prefix || undefined,
  );
}

function appendRawLine(section: ManualSection, line: string, sourceId: string): void {
  const kind = classifyManualLine(line);
  if (kind === 'safety') {
    const previous = section.units.at(-1);
    if (
      previous?.kind === 'text' &&
      (previous.role === 'step' || previous.role === 'instruction') &&
      section.pendingSafety.length === 0
    ) {
      previous.text += `\n${line}`;
      previous.sourceIds = unique([...previous.sourceIds, sourceId]);
      previous.safetySuffix = `${previous.safetySuffix ?? ''}\n${line}`;
      return;
    }
    section.pendingSafety.push({ text: line, sourceId });
    return;
  }
  if (kind === 'step') {
    appendPendingSafetyToInstruction(section, line, sourceId, 'step');
    return;
  }
  if (!line.trim() && section.pendingSafety.length > 0) {
    appendText(section, line, [sourceId]);
    return;
  }
  appendPendingSafetyToInstruction(section, line, sourceId, 'instruction');
}

function renderStructuredListItem(block: DocumentBlock, ordinal?: number): string {
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

function createSection(path: string[], headingSourceIds: string[] = []): ManualSection {
  return { path, headingSourceIds, units: [], pendingSafety: [], warnings: [] };
}

/** Moves pending safety out of the section so it can frame an adjacent table. */
function takePendingSafety(section: ManualSection): { lines: string[]; sourceIds: string[] } {
  const lines = section.pendingSafety.map((entry) => entry.text);
  const sourceIds = pendingSafetySourceIds(section);
  section.pendingSafety = [];
  return { lines, sourceIds };
}

interface SectionOrdinal {
  family: string;
  value: number;
}

interface DottedManualHeading {
  prefix: string;
  depth: number;
  text: string;
}

const HANGUL_ORDER = '가나다라마바사아자차카타파하';

/**
 * Deliberately narrower than classifyManualLine: dotted number paths are
 * inferred only for short heading-like text. Lists and imperative work steps
 * continue through the existing classifier and list-demotion rules.
 */
function parseDottedManualHeading(line: string): DottedManualHeading | null {
  const trimmed = line.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+){0,3})\.?\s+(.+?)\s*$/u);
  if (!match) return null;

  const title = match[2].trim();
  if (
    !title ||
    title.length > 80 ||
    imperativeEnding.test(trimmed) ||
    dotlessSentenceEnding.test(title) ||
    /[.!?]\s*$/u.test(title)
  ) {
    return null;
  }

  return {
    prefix: match[1],
    depth: match[1].split('.').length,
    text: trimmed,
  };
}

function hasDottedManualHeadingPrefix(line: string): boolean {
  return /^\s*\d+(?:\.\d+){0,3}\.?\s+\S/u.test(line);
}

/** Reads the ordinal marker of a numbered line so sibling runs can be detected. */
function sectionLineOrdinal(line: string): SectionOrdinal | null {
  const trimmed = line.trim();
  let match = trimmed.match(/^(\d+)-(\d+)\s+/u);
  if (match) return { family: `dash-${match[1]}`, value: Number(match[2]) };
  match = trimmed.match(/^(\d+)[.)]\s+/u);
  if (match) return { family: 'arabic', value: Number(match[1]) };
  match = trimmed.match(/^(\d+)\s+/u);
  if (match) return { family: 'bare-arabic', value: Number(match[1]) };
  match = trimmed.match(/^([①-⑳])\s*/u);
  if (match) return { family: 'circled', value: match[1].codePointAt(0)! - 0x2460 + 1 };
  match = trimmed.match(/^([가-힣])\)\s+/u);
  if (match) {
    const order = HANGUL_ORDER.indexOf(match[1]);
    return order >= 0 ? { family: 'hangul', value: order + 1 } : null;
  }
  match = trimmed.match(/^(?:step|단계)\s*(\d+)/iu);
  if (match) return { family: 'step', value: Number(match[1]) };
  return null;
}

/**
 * Numbered section/step lines that form a consecutive sibling run
 * (1., 2., 3. on adjacent lines) are a list, not a stack of headings —
 * treating each as a section silently drops every title but the last.
 */
function demotedSectionLineIndexes(lines: string[]): Set<number> {
  const sequence = lines
    .map((line, index) => ({
      index,
      blank: line.trim().length === 0,
      section: ['section', 'step'].includes(classifyManualLine(line)),
      ordinal: sectionLineOrdinal(line),
    }))
    .filter((entry) => !entry.blank);
  const demoted = new Set<number>();
  for (let position = 0; position < sequence.length; position += 1) {
    const entry = sequence[position];
    if (!entry.section || !entry.ordinal) continue;
    const next = sequence[position + 1];
    const previous = sequence[position - 1];
    const nextIsSuccessor = Boolean(
      next?.section && next.ordinal &&
      next.ordinal.family === entry.ordinal.family &&
      next.ordinal.value === entry.ordinal.value + 1,
    );
    const previousWasDemotedPredecessor = Boolean(
      previous && demoted.has(previous.index) && previous.ordinal &&
      previous.ordinal.family === entry.ordinal.family &&
      previous.ordinal.value === entry.ordinal.value - 1,
    );
    if (nextIsSuccessor || previousWasDemotedPredecessor) demoted.add(entry.index);
  }
  return demoted;
}

function tableFromRawLines(lines: string[], sourceId: string, index: number): DocumentBlock | null {
  const [table] = extractMarkdownTableBlocks(lines.join('\n'), `${sourceId}-manual-${index}`);
  return table ?? null;
}

function parseManualSections(document: ExtractedDocument): ManualSection[] {
  const sections: ManualSection[] = [];
  const listOrdinals = orderedListOrdinals(document.blocks);
  let current = createSection([]);
  let tableIndex = 0;
  let activeDottedHeadings: DottedManualHeading[] = [];

  const startSection = (path: string[], headingSourceIds: string[] = []): void => {
    appendUnpairedSafety(current);
    sections.push(current);
    current = createSection(path, headingSourceIds);
  };
  const ensurePath = (path: string[]): void => {
    if (!samePath(current.path, path)) startSection(path);
  };
  const resetDottedHeadingStack = (): void => {
    activeDottedHeadings = [];
  };
  const startConfirmedDottedHeading = (
    heading: DottedManualHeading,
    sourceId: string,
  ): boolean => {
    if (heading.depth === 1) {
      activeDottedHeadings = [heading];
      startSection([heading.text], [sourceId]);
      return true;
    }

    const parentPrefix = heading.prefix.split('.').slice(0, -1).join('.');
    const directParent = activeDottedHeadings[heading.depth - 2];
    if (!directParent || directParent.prefix !== parentPrefix) return false;

    activeDottedHeadings = [...activeDottedHeadings.slice(0, heading.depth - 1), heading];
    startSection(activeDottedHeadings.map((entry) => entry.text), [sourceId]);
    return true;
  };

  for (const block of [...document.blocks].sort((left, right) => left.order - right.order)) {
    if (block.kind === 'heading') {
      resetDottedHeadingStack();
      startSection(headingPathForBlock(block), [block.id]);
      continue;
    }

    if (block.kind === 'table') {
      if (block.headingPath.length > 0) {
        resetDottedHeadingStack();
        ensurePath(block.headingPath);
      }
      const safety = takePendingSafety(current);
      current.units.push({
        kind: 'table',
        block,
        sourceIds: unique([...safety.sourceIds, block.id]),
        ...(safety.lines.length > 0 ? { safetyLines: safety.lines } : {}),
      });
      continue;
    }

    if (block.kind === 'paragraph') {
      if (block.headingPath.length > 0) {
        resetDottedHeadingStack();
        ensurePath(block.headingPath);
      }
      for (const line of (block.text ?? '').replace(/\r\n?/gu, '\n').split('\n')) {
        appendRawLine(current, line, block.id);
      }
      continue;
    }

    if (block.kind === 'list-item') {
      if (block.headingPath.length > 0) {
        resetDottedHeadingStack();
        ensurePath(block.headingPath);
      }
      const text = block.text ?? '';
      if (safetyLabel.test(text.trim())) {
        appendRawLine(current, text, block.id);
      } else if (text) {
        appendPendingSafetyToInstruction(
          current,
          renderStructuredListItem(block, listOrdinals.get(block.id)),
          block.id,
          'step',
        );
      }
      continue;
    }

    if (block.kind !== 'raw-text') continue;

    const structuredPath = block.headingPath.length > 0;
    if (structuredPath) {
      resetDottedHeadingStack();
      ensurePath(block.headingPath);
    }
    const lines = (block.text ?? '').replace(/\r\n?/gu, '\n').split('\n');
    const demotedSectionLines = demotedSectionLineIndexes(lines);
    let orphanDottedNumberingWarned = false;
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
        const safety = takePendingSafety(current);
        const table = tableFromRawLines(tableLines, block.id, ++tableIndex);
        if (table) {
          current.units.push({
            kind: 'table',
            block: table,
            sourceIds: unique([...safety.sourceIds, block.id]),
            ...(safety.lines.length > 0 ? { safetyLines: safety.lines } : {}),
          });
        } else {
          if (safety.lines.length > 0) {
            appendText(current, safety.lines.join('\n'), safety.sourceIds);
          }
          appendText(current, tableLines.join('\n'), [block.id]);
        }
        continue;
      }

      const dottedHeading = structuredPath || demotedSectionLines.has(index)
        ? null
        : parseDottedManualHeading(line);
      if (dottedHeading) {
        const confirmed = startConfirmedDottedHeading(dottedHeading, block.id);
        if (!confirmed && !orphanDottedNumberingWarned) {
          current.warnings.push({
            code: 'manual-deep-numbering-unstructured',
            severity: 'warning',
            message: '번호 계층의 직접 부모를 확인할 수 없습니다. 원문은 본문으로 보존했으니 전처리 결과를 확인하세요.',
            locations: [block.id],
          });
          orphanDottedNumberingWarned = true;
        }
        if (!confirmed) appendRawLine(current, line, block.id);
      } else if (!structuredPath && !demotedSectionLines.has(index) && hasDottedManualHeadingPrefix(line)) {
        appendRawLine(current, line, block.id);
      } else if (!structuredPath && classifyManualLine(line) === 'section' && !demotedSectionLines.has(index)) {
        resetDottedHeadingStack();
        startSection([line.trim()], [block.id]);
      } else if (demotedSectionLines.has(index)) {
        appendPendingSafetyToInstruction(current, line, block.id, 'step');
      } else {
        appendRawLine(current, line, block.id);
      }
    }
  }
  appendUnpairedSafety(current);
  sections.push(current);
  return sections;
}

function claimSourceIds(candidates: string[], claimed: Set<string>): string[] {
  const result: string[] = [];
  for (const sourceId of candidates) {
    if (sourceId && !claimed.has(sourceId)) {
      claimed.add(sourceId);
      result.push(sourceId);
    }
  }
  return result;
}

function draft(body: string, contextLines: string[], sourceIds: string[]): ChunkDraft {
  return { body, contextLines, sourceBlockIds: sourceIds, warnings: [] };
}

function splitOversizedStep(unit: TextUnit, limit: number): string[] | null {
  if (unit.text.length <= limit) return [unit.text];
  if (!unit.safetyPrefix && !unit.safetySuffix) {
    return splitTextPreservingSeparators(unit.text, limit);
  }

  let instruction = unit.text;
  let prefix = '';
  let suffix = '';
  if (unit.safetyPrefix) {
    const afterPrefix = instruction.slice(unit.safetyPrefix.length);
    const separator = afterPrefix.startsWith('\n') ? '\n' : '';
    prefix = `${unit.safetyPrefix}${separator}`;
    instruction = afterPrefix.slice(separator.length);
  }
  if (unit.safetySuffix) {
    suffix = unit.safetySuffix;
    instruction = instruction.endsWith(suffix)
      ? instruction.slice(0, -suffix.length)
      : instruction;
  }

  const firstLimit = limit - prefix.length;
  const lastLimit = limit - suffix.length;
  if (firstLimit < 1 || lastLimit < 1 || !instruction) return null;
  const instructionFragments = splitTextPreservingSeparators(
    instruction,
    Math.min(firstLimit, lastLimit),
  );
  if (instructionFragments.length === 1 && prefix.length + instruction.length + suffix.length > limit) {
    instructionFragments.splice(0, 1, instruction.slice(0, -1), instruction.slice(-1));
  }
  const first = instructionFragments.shift();
  const last = instructionFragments.pop();
  if (!first || !last) return first ? [`${prefix}${first}${suffix}`] : null;
  return [`${prefix}${first}`, ...instructionFragments, `${last}${suffix}`];
}

function renderSection(
  section: ManualSection,
  carriedHeadingIds: string[],
  fileName: string,
  claimed: Set<string>,
): { drafts: ChunkDraft[]; warnings: PreprocessIssue[]; isEmpty: boolean; headingIds: string[] } {
  if (section.units.length === 0) {
    return {
      drafts: [],
      warnings: [],
      isEmpty: true,
      headingIds: [...carriedHeadingIds, ...section.headingSourceIds],
    };
  }

  const contextLines = sectionContext(fileName, section.path);
  const limit = bodyLimit(contextLines);
  const drafts: ChunkDraft[] = [];
  const warnings: PreprocessIssue[] = [...section.warnings];
  let initialSources = [...carriedHeadingIds, ...section.headingSourceIds];
  let body = '';
  let bodySources: string[] = [];

  const flush = (): void => {
    if (!body) return;
    drafts.push(draft(body, contextLines, claimSourceIds(bodySources, claimed)));
    body = '';
    bodySources = [];
  };

  for (const unit of section.units) {
    if (unit.kind === 'table') {
      flush();
      const tableContext = [...contextLines, ...(unit.safetyLines ?? [])];
      const tableOutput = chunkTableBlock(unit.block, tableContext);
      warnings.push(...tableOutput.warnings);
      tableOutput.drafts.forEach((tableDraft, index) => {
        const candidates = index === 0
          ? [...initialSources, ...unit.sourceIds]
          : [];
        drafts.push({
          ...tableDraft,
          sourceBlockIds: claimSourceIds(candidates, claimed),
        });
      });
      initialSources = [];
      continue;
    }

    const safetyAware = Boolean(unit.safetyPrefix || unit.safetySuffix);
    let nonStepFragments = [unit.text];
    if (unit.role !== 'step' && !safetyAware && unit.text.length > limit) {
      // Prose that separates cleanly at paragraph or sentence boundaries is
      // split; anything that would need an arbitrary mid-word cut is blocked.
      const attempted = splitTextPreservingSeparators(unit.text, limit);
      const clean = attempted.slice(0, -1).every((fragment) => /(?:\s|[.!?。！？])$/u.test(fragment));
      if (clean && attempted.length > 1) {
        nonStepFragments = attempted;
      } else {
        warnings.push({
          code: 'manual-non-step-exceeds-limit',
          severity: 'error',
          message: 'A non-step manual unit exceeds the chunk limit and cannot be split at a step boundary.',
          locations: unit.sourceIds,
        });
      }
    }
    const fragments = unit.role === 'step' || safetyAware
      ? splitOversizedStep(unit, limit)
      : nonStepFragments;
    if (!fragments) {
      warnings.push({
        code: 'manual-step-safety-prefix-exceeds-limit',
        severity: 'error',
        message: 'Safety text leaves no room for the adjacent step in one chunk.',
        locations: unit.sourceIds,
      });
      continue;
    }
    fragments.forEach((fragment, index) => {
      const candidates = index === 0
        ? [...initialSources, ...unit.sourceIds]
        : [];
      const separator = body ? '\n' : '';
      if (body && body.length + separator.length + fragment.length > limit) flush();
      body += `${body ? '\n' : ''}${fragment}`;
      bodySources.push(...candidates);
      initialSources = [];
      if (body.length >= limit) flush();
    });
  }
  flush();
  return { drafts, warnings, isEmpty: false, headingIds: [] };
}

/**
 * Chunks work instructions by explicit section, while keeping safety labels
 * with their next numbered step and preserving one source claim per block.
 */
export function chunkManualDocument(document: ExtractedDocument): ChunkingOutput {
  const drafts: ChunkDraft[] = [];
  const warnings: PreprocessIssue[] = [...document.warnings];
  const claimed = new Set<string>();
  let carriedHeadingIds: string[] = [];
  let lastPath: string[] = [];

  for (const section of parseManualSections(document)) {
    const rendered = renderSection(section, carriedHeadingIds, document.fileName, claimed);
    lastPath = section.path;
    if (rendered.isEmpty) {
      carriedHeadingIds = rendered.headingIds;
      continue;
    }
    carriedHeadingIds = [];
    drafts.push(...rendered.drafts);
    warnings.push(...rendered.warnings);
  }

  if (carriedHeadingIds.length > 0) {
    drafts.push(draft('', sectionContext(document.fileName, lastPath), claimSourceIds(carriedHeadingIds, claimed)));
  }

  return {
    drafts,
    expectedSourceBlockIds: document.blocks.filter(hasSource).map((block) => block.id),
    warnings,
  };
}
