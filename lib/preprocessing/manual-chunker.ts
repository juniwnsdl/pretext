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

type ManualLineKind = 'section' | 'step' | 'safety' | 'paragraph';

interface TextUnit {
  kind: 'text';
  text: string;
  sourceIds: string[];
}

interface TableUnit {
  kind: 'table';
  block: DocumentBlock;
  sourceIds: string[];
}

type ManualUnit = TextUnit | TableUnit;

interface ManualSection {
  path: string[];
  headingSourceIds: string[];
  units: ManualUnit[];
  pendingSafety: Array<{ text: string; sourceId: string }>;
}

const safetyLabel = /^(?:\[\s*(?:주의|경고|위험|안전|중요|필독)\s*\]|(?:주의|경고|위험|안전|중요|필독)\s*[:：]|※)/u;
const numberedLabel = /^\s*(?:\d+\.\s+|\d+\)\s+|\d+-\d+\s+|[가-힣]\)\s+|[①-⑳]\s*|Step\s*\d+(?:\s*[:.)-])?\s+|단계\s*\d+(?:\s*[:.)-])?\s+)/iu;
const imperativeEnding = /(?:다|시오|세요)\.\s*$/u;
const bareSectionLabel = /^(?:개요|목적|범위|준비(?:\s*사항)?|절차|작업\s*절차|점검(?:\s*사항)?|기동|운전|종료|주의(?:\s*사항)?|안전\s*수칙)\s*$/u;

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
  if (/^#{1,6}\s+\S/u.test(trimmed)) return 'section';
  if (bareSectionLabel.test(trimmed)) return 'section';
  if (numberedLabel.test(line)) {
    return imperativeEnding.test(trimmed) ? 'step' : 'section';
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

function appendText(section: ManualSection, text: string, sourceIds: string[]): void {
  const previous = section.units.at(-1);
  if (
    previous?.kind === 'text' &&
    previous.sourceIds.length === 1 &&
    sourceIds.length === 1 &&
    previous.sourceIds[0] === sourceIds[0]
  ) {
    previous.text += `\n${text}`;
    return;
  }
  section.units.push({ kind: 'text', text, sourceIds: unique(sourceIds) });
}

function flushPendingSafety(section: ManualSection): void {
  if (section.pendingSafety.length === 0) return;
  appendText(
    section,
    section.pendingSafety.map((entry) => entry.text).join('\n'),
    section.pendingSafety.map((entry) => entry.sourceId),
  );
  section.pendingSafety = [];
}

function appendRawLine(section: ManualSection, line: string, sourceId: string): void {
  const kind = classifyManualLine(line);
  if (kind === 'safety') {
    section.pendingSafety.push({ text: line, sourceId });
    return;
  }
  if (kind === 'step') {
    const step = [...section.pendingSafety.map((entry) => entry.text), line].join('\n');
    const sourceIds = unique([
      ...section.pendingSafety.map((entry) => entry.sourceId),
      sourceId,
    ]);
    section.pendingSafety = [];
    section.units.push({ kind: 'text', text: step, sourceIds });
    return;
  }
  flushPendingSafety(section);
  appendText(section, line, [sourceId]);
}

function createSection(path: string[], headingSourceIds: string[] = []): ManualSection {
  return { path, headingSourceIds, units: [], pendingSafety: [] };
}

function tableFromRawLines(lines: string[], sourceId: string, index: number): DocumentBlock | null {
  const [table] = extractMarkdownTableBlocks(lines.join('\n'), `${sourceId}-manual-${index}`);
  return table ?? null;
}

function parseManualSections(document: ExtractedDocument): ManualSection[] {
  const sections: ManualSection[] = [];
  let current = createSection([]);
  let tableIndex = 0;

  const startSection = (path: string[], headingSourceIds: string[] = []): void => {
    flushPendingSafety(current);
    sections.push(current);
    current = createSection(path, headingSourceIds);
  };
  const ensurePath = (path: string[]): void => {
    if (!samePath(current.path, path)) startSection(path);
  };

  for (const block of [...document.blocks].sort((left, right) => left.order - right.order)) {
    if (block.kind === 'heading') {
      startSection(headingPathForBlock(block), [block.id]);
      continue;
    }

    if (block.kind === 'table') {
      if (block.headingPath.length > 0) ensurePath(block.headingPath);
      flushPendingSafety(current);
      current.units.push({ kind: 'table', block, sourceIds: [block.id] });
      continue;
    }

    if (block.kind !== 'raw-text') {
      if (block.headingPath.length > 0) ensurePath(block.headingPath);
      const text = block.text ?? '';
      if (text) {
        flushPendingSafety(current);
        current.units.push({ kind: 'text', text, sourceIds: [block.id] });
      }
      continue;
    }

    const lines = (block.text ?? '').replace(/\r\n?/gu, '\n').split('\n');
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
        flushPendingSafety(current);
        const table = tableFromRawLines(tableLines, block.id, ++tableIndex);
        if (table) current.units.push({ kind: 'table', block: table, sourceIds: [block.id] });
        else appendText(current, tableLines.join('\n'), [block.id]);
        continue;
      }

      if (classifyManualLine(line) === 'section') {
        startSection([line.trim()], [block.id]);
      } else {
        appendRawLine(current, line, block.id);
      }
    }
  }
  flushPendingSafety(current);
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
  const warnings: PreprocessIssue[] = [];
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
      const tableOutput = chunkTableBlock(unit.block, contextLines);
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

    const fragments = unit.text.length <= limit
      ? [unit.text]
      : splitTextPreservingSeparators(unit.text, limit);
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
