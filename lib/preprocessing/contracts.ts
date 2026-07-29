export const APP_CHUNK_LIMIT = 3800;
export const MISO_CHUNK_LIMIT = 4000;
export const MISO_SEPARATOR = '@@@';
export const MISO_JOINER = '\n@@@\n';

export type ResultStatus = 'ready' | 'review' | 'blocked';
export type IssueSeverity = 'warning' | 'error';

export interface PreprocessIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  count?: number;
  locations?: string[];
}

export interface DocumentBlock {
  id: string;
  kind: 'raw-text' | 'heading' | 'paragraph' | 'list-item' | 'table';
  order: number;
  headingPath: string[];
  text?: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  depth?: number;
  ordered?: boolean;
  rows?: string[][];
  sheetName?: string;
  tableId?: string;
  merges?: Array<{
    range: string;
    start: { row: number; column: number };
    end: { row: number; column: number };
  }>;
}

export interface ExtractedDocument {
  version: 1;
  fileName: string;
  sourceFormat: string;
  extractionMethod: 'local-text' | 'local-excel' | 'local-docx' | 'miso' | 'user-edited';
  blocks: DocumentBlock[];
  warnings: PreprocessIssue[];
}

export interface ChunkDraft {
  body: string;
  contextLines: string[];
  sourceBlockIds: string[];
  warnings: PreprocessIssue[];
}

export interface ChunkingOutput {
  drafts: ChunkDraft[];
  expectedSourceBlockIds: string[];
  warnings: PreprocessIssue[];
}

export interface PreprocessResult {
  processedText: string;
  chunks: string[];
  stats: {
    originalLength: number;
    processedLength: number;
    chunkCount: number;
    longestChunkLength: number;
    safeLimitExceededCount: number;
    misoLimitExceededCount: number;
    sourceSeparatorCollisionCount: number;
    unresolvedSeparatorCollisionCount: number;
    emptyChunkCount: number;
  };
  issues: PreprocessIssue[];
  resultStatus: ResultStatus;
  canDownload: boolean;
}
