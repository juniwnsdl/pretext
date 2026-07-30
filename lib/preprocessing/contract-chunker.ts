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
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './table-chunker.ts';

interface ArticleHeading {
  key: string;
  text: string;
}

interface ArticleCandidate {
  blockIndex: number;
  heading: ArticleHeading;
}

interface ArticleUnit {
  heading: ArticleHeading;
  body: string;
  contentBlocks: DocumentBlock[];
  sourceBlockIds: string[];
}

function hasSource(block: DocumentBlock): boolean {
  return block.kind === 'table'
    ? (block.rows ?? []).some((row) => row.some((cell) => cell.trim().length > 0))
    : Boolean(block.text?.trim().length);
}

function parseArticleHeading(block: DocumentBlock): ArticleHeading | null {
  if (block.kind === 'table' || block.kind === 'raw-text') return null;
  const text = (block.text ?? '').trim().replace(/\s+/gu, ' ');
  const match = text.match(
    /^제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*(?:\([^()\n]{1,120}\))?$/u,
  );
  if (!match) return null;
  return {
    key: `${Number(match[1])}:${match[2] ? Number(match[2]) : 0}`,
    text,
  };
}

function renderListItem(block: DocumentBlock, ordinal?: number): string {
  const lines = (block.text ?? '').replace(/\r\n?/gu, '\n').split('\n');
  const indentation = '  '.repeat(Math.max(0, block.depth ?? 0));
  const marker = block.ordered ? `${ordinal ?? 1}. ` : '- ';
  const firstLine = lines[0].replace(/^\s*(?:[-*+•◦]|\d+[.)])\s+/u, '');
  const continuationIndentation = `${indentation}   `;
  return [
    `${indentation}${marker}${firstLine}`,
    ...lines.slice(1).map((line) => `${continuationIndentation}${line}`),
  ].join('\n');
}

function renderTable(block: DocumentBlock): string {
  const rows = block.rows ?? [];
  if (rows.length === 0) return '';
  const width = rows.reduce((largest, row) => Math.max(largest, row.length), 0);
  if (width === 0) return '';
  const normalized = rows.map((row) => Array.from(
    { length: width },
    (_, index) => (row[index] ?? '').replaceAll('|', '\\|').replace(/\r\n?|\n/gu, '<br>'),
  ));
  return [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function renderBlock(block: DocumentBlock, listOrdinals: Map<string, number>): string {
  if (block.kind === 'table') return renderTable(block);
  if (block.kind === 'list-item') return renderListItem(block, listOrdinals.get(block.id));
  return (block.text ?? '').trim();
}

function findActualArticleCandidateIndex(
  candidates: ArticleCandidate[],
): { actualCandidateIndex: number; tocStartBlockIndex: number | null } {
  for (let index = 1; index < candidates.length; index += 1) {
    const prefix = candidates.slice(0, index);
    const prefixKeys = new Set(prefix.map((candidate) => candidate.heading.key));
    if (!prefixKeys.has(candidates[index].heading.key) || prefixKeys.size < 3) continue;

    const repeatedWindow = candidates.slice(index, index + Math.min(12, prefixKeys.size));
    const recurrenceCount = repeatedWindow.filter(
      (candidate) => prefixKeys.has(candidate.heading.key),
    ).length;
    const occupiedRange = candidates[index].blockIndex - candidates[0].blockIndex;
    const candidateDensity = occupiedRange > 0 ? prefix.length / occupiedRange : 0;
    if (recurrenceCount >= 3 && candidateDensity >= 0.6) {
      return {
        actualCandidateIndex: index,
        tocStartBlockIndex: candidates[0].blockIndex,
      };
    }
  }
  return { actualCandidateIndex: 0, tocStartBlockIndex: null };
}

function contextLength(contextLines: string[]): number {
  return contextLines.join('\n').length + 1;
}

function articleRangeContext(fileName: string, articles: ArticleUnit[]): string[] {
  const articleLabel = (article: ArticleUnit): string => article.heading.text
    .replace(/\s*\([^()\n]*\)\s*$/u, '')
    .trim();
  const first = articleLabel(articles[0]);
  const lastArticle = articles.at(-1);
  const last = lastArticle ? articleLabel(lastArticle) : first;
  return [
    `[문서] ${fileName}`,
    `[조문 범위] ${first === last ? first : `${first} ~ ${last}`}`,
  ];
}

function renderCompleteArticles(articles: ArticleUnit[]): string {
  return articles.map((article) => [article.heading.text, article.body]
    .filter(Boolean)
    .join('\n')).join('\n\n');
}

function completeArticlesFit(fileName: string, articles: ArticleUnit[]): boolean {
  const context = articleRangeContext(fileName, articles);
  return contextLength(context) + renderCompleteArticles(articles).length <= APP_CHUNK_LIMIT;
}

function longArticleDrafts(
  fileName: string,
  article: ArticleUnit,
  listOrdinals: Map<string, number>,
): { drafts: ChunkDraft[]; warnings: PreprocessIssue[] } {
  const contextLines = [`[문서] ${fileName}`, `[조문] ${article.heading.text}`];
  const bodyLimit = APP_CHUNK_LIMIT - contextLength(contextLines);
  const drafts: ChunkDraft[] = [];
  const warnings: PreprocessIssue[] = [];
  let textParts: string[] = [];

  const flushText = (): void => {
    const text = textParts.join('\n');
    textParts = [];
    if (!text.trim()) return;
    for (const body of splitTextPreservingSeparators(text, bodyLimit)) {
      drafts.push({ body, contextLines, sourceBlockIds: [], warnings: [] });
    }
  };

  // Tables split through the table chunker so continuation chunks repeat the
  // table header instead of being cut mid-row.
  for (const block of article.contentBlocks) {
    if (block.kind === 'table') {
      flushText();
      const tableOutput = chunkTableBlock(block, contextLines);
      warnings.push(...tableOutput.warnings);
      drafts.push(...tableOutput.drafts.map((draft) => ({ ...draft, sourceBlockIds: [] })));
      continue;
    }
    const rendered = renderBlock(block, listOrdinals);
    if (rendered) textParts.push(rendered);
  }
  flushText();

  if (drafts.length === 0) {
    drafts.push({ body: '', contextLines, sourceBlockIds: [], warnings: [] });
  }
  drafts[0].sourceBlockIds = [...article.sourceBlockIds];
  return { drafts, warnings };
}

/** Detects article-based contracts inside structured general documents. */
export function chunkContractDocument(document: ExtractedDocument): ChunkingOutput | null {
  if (document.blocks.some((block) => block.kind === 'raw-text')) return null;

  const blocks = [...document.blocks]
    .sort((left, right) => left.order - right.order)
    .filter(hasSource);
  const candidates = blocks.flatMap((block, blockIndex) => {
    const heading = parseArticleHeading(block);
    return heading ? [{ blockIndex, heading }] : [];
  });
  if (candidates.length < 3) return null;

  const { actualCandidateIndex, tocStartBlockIndex } = findActualArticleCandidateIndex(candidates);
  const actualCandidates = candidates.slice(actualCandidateIndex);
  if (actualCandidates.length < 3) return null;

  const listOrdinals = orderedListOrdinals(document.blocks);
  const articleUnits: ArticleUnit[] = actualCandidates.map((candidate, index) => {
    const nextBlockIndex = actualCandidates[index + 1]?.blockIndex ?? blocks.length;
    const articleBlocks = blocks.slice(candidate.blockIndex, nextBlockIndex);
    const contentBlocks = articleBlocks.slice(1);
    return {
      heading: candidate.heading,
      body: contentBlocks.map((block) => renderBlock(block, listOrdinals)).filter(Boolean).join('\n'),
      contentBlocks,
      sourceBlockIds: articleBlocks.map((block) => block.id),
    };
  });
  if (articleUnits.filter((article) => article.body.trim().length > 0).length < 2) return null;

  const actualStartBlockIndex = actualCandidates[0].blockIndex;
  const preambleEnd = tocStartBlockIndex ?? actualStartBlockIndex;
  const preambleBlocks = blocks.slice(0, preambleEnd);
  const preambleText = preambleBlocks
    .map((block) => renderBlock(block, listOrdinals))
    .filter(Boolean)
    .join('\n\n');
  const drafts: ChunkDraft[] = [];
  const warnings: PreprocessIssue[] = [...document.warnings];

  let packed: ArticleUnit[] = [];
  const flushPacked = (): void => {
    if (packed.length === 0) return;
    drafts.push({
      body: renderCompleteArticles(packed),
      contextLines: articleRangeContext(document.fileName, packed),
      sourceBlockIds: packed.flatMap((article) => article.sourceBlockIds),
      warnings: [],
    });
    packed = [];
  };

  for (const article of articleUnits) {
    if (!completeArticlesFit(document.fileName, [article])) {
      flushPacked();
      const longOutput = longArticleDrafts(document.fileName, article, listOrdinals);
      drafts.push(...longOutput.drafts);
      warnings.push(...longOutput.warnings);
      continue;
    }
    const candidatePack = [...packed, article];
    if (packed.length > 0 && !completeArticlesFit(document.fileName, candidatePack)) flushPacked();
    packed.push(article);
  }
  flushPacked();

  const firstDraft = drafts[0];
  const canMergePreamble = Boolean(
    preambleText
    && firstDraft?.contextLines.some((line) => line.startsWith('[조문 범위]'))
    && contextLength(firstDraft.contextLines) + preambleText.length + 2 + firstDraft.body.length
      <= APP_CHUNK_LIMIT,
  );
  if (canMergePreamble && firstDraft) {
    firstDraft.body = `${preambleText}\n\n${firstDraft.body}`;
    firstDraft.sourceBlockIds = [
      ...preambleBlocks.map((block) => block.id),
      ...firstDraft.sourceBlockIds,
    ];
  } else if (preambleText) {
    drafts.unshift({
      body: preambleText,
      contextLines: [`[문서] ${document.fileName}`, '[섹션] 전문'],
      sourceBlockIds: preambleBlocks.map((block) => block.id),
      warnings: [],
    });
  }

  const includedBlocks = [
    ...preambleBlocks,
    ...blocks.slice(actualStartBlockIndex),
  ];
  return {
    drafts,
    expectedSourceBlockIds: includedBlocks.map((block) => block.id),
    warnings,
  };
}
