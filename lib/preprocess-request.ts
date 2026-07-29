import {
  MISO_SEPARATOR,
  type DocumentBlock,
  type ExtractedDocument,
  type PreprocessIssue,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './preprocessing/contracts.ts';
import {
  normalizeDocType,
  type DocType,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './text-preprocessor.ts';

export interface PreprocessRequestInput {
  document?: unknown;
  text?: unknown;
  docType?: unknown;
  separator?: unknown;
}

export interface NormalizedPreprocessRequest {
  document: ExtractedDocument;
  docType: DocType;
  separator: typeof MISO_SEPARATOR;
}

export interface PreprocessRequestError {
  code:
    | 'INVALID_REQUEST'
    | 'INVALID_SEPARATOR'
    | 'MISSING_INPUT'
    | 'EMPTY_INPUT'
    | 'INVALID_DOCUMENT'
    | 'INVALID_BLOCK';
  message: string;
}

export type PreprocessRequestResult =
  | { ok: true; value: NormalizedPreprocessRequest }
  | { ok: false; error: PreprocessRequestError };

const BLOCK_KINDS = new Set<DocumentBlock['kind']>([
  'raw-text',
  'heading',
  'paragraph',
  'list-item',
  'table',
]);
const EXTRACTION_METHODS = new Set<ExtractedDocument['extractionMethod']>([
  'local-text',
  'local-excel',
  'local-docx',
  'miso',
  'user-edited',
]);

function failure(
  code: PreprocessRequestError['code'],
  message: string,
): PreprocessRequestResult {
  return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Removes path components, control characters, and unsafe filename characters. */
export function sanitizePreprocessFileName(value: unknown): string {
  if (typeof value !== 'string') return 'document.txt';
  const baseName = value.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const sanitized = baseName
    .replace(/[\u0000-\u001F\u007F]/gu, '')
    .replace(/[<>:"/\\|?*]/gu, '_')
    .trim()
    .replace(/[. ]+$/gu, '')
    .slice(0, 255);
  return sanitized && sanitized !== '.' && sanitized !== '..'
    ? sanitized
    : 'document.txt';
}

function validIssue(value: unknown): value is PreprocessIssue {
  if (!isRecord(value)) return false;
  if (typeof value.code !== 'string' || value.code.length === 0) return false;
  if (value.severity !== 'warning' && value.severity !== 'error') return false;
  if (typeof value.message !== 'string' || value.message.length === 0) return false;
  if (hasOwn(value, 'count') && (!Number.isInteger(value.count) || Number(value.count) < 0)) {
    return false;
  }
  return !hasOwn(value, 'locations')
    || (Array.isArray(value.locations) && value.locations.every((entry) => typeof entry === 'string'));
}

function validPosition(value: unknown): value is { row: number; column: number } {
  return isRecord(value)
    && Number.isInteger(value.row)
    && Number(value.row) >= 0
    && Number.isInteger(value.column)
    && Number(value.column) >= 0;
}

function validMerge(value: unknown): boolean {
  return isRecord(value)
    && typeof value.range === 'string'
    && value.range.length > 0
    && validPosition(value.start)
    && validPosition(value.end);
}

function validBlock(value: unknown): value is DocumentBlock {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (!BLOCK_KINDS.has(value.kind as DocumentBlock['kind'])) return false;
  if (!Number.isInteger(value.order) || Number(value.order) < 0) return false;
  if (!Array.isArray(value.headingPath) || !value.headingPath.every((entry) => typeof entry === 'string')) {
    return false;
  }

  if (hasOwn(value, 'rows')) {
    if (!Array.isArray(value.rows)) return false;
    if (!value.rows.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'))) {
      return false;
    }
  } else if (value.kind === 'table') {
    return false;
  }
  if (value.kind !== 'table' && typeof value.text !== 'string') {
    return false;
  }

  if (hasOwn(value, 'text') && typeof value.text !== 'string') return false;
  if (hasOwn(value, 'level') && (!Number.isInteger(value.level) || Number(value.level) < 1 || Number(value.level) > 6)) {
    return false;
  }
  if (hasOwn(value, 'depth') && (!Number.isInteger(value.depth) || Number(value.depth) < 0)) {
    return false;
  }
  if (hasOwn(value, 'ordered') && typeof value.ordered !== 'boolean') return false;
  if (hasOwn(value, 'sheetName') && typeof value.sheetName !== 'string') return false;
  if (hasOwn(value, 'tableId') && typeof value.tableId !== 'string') return false;
  return !hasOwn(value, 'merges')
    || (Array.isArray(value.merges) && value.merges.every(validMerge));
}

function blockHasContent(block: DocumentBlock): boolean {
  if (block.kind === 'table') {
    return (block.rows ?? []).some((row) => row.some((cell) => cell.trim().length > 0));
  }
  return Boolean(block.text?.trim());
}

function cloneBlock(block: DocumentBlock): DocumentBlock {
  return {
    ...block,
    headingPath: [...block.headingPath],
    ...(block.rows ? { rows: block.rows.map((row) => [...row]) } : {}),
    ...(block.merges ? {
      merges: block.merges.map((merge) => ({
        ...merge,
        start: { ...merge.start },
        end: { ...merge.end },
      })),
    } : {}),
  };
}

function normalizeDocument(value: unknown):
  | { ok: true; document: ExtractedDocument }
  | { ok: false; error: PreprocessRequestError } {
  if (!isRecord(value)) {
    return { ok: false, error: { code: 'INVALID_DOCUMENT', message: 'Document must be an object.' } };
  }
  if (
    value.version !== 1
    || typeof value.fileName !== 'string'
    || typeof value.sourceFormat !== 'string'
    || value.sourceFormat.trim().length === 0
    || !EXTRACTION_METHODS.has(value.extractionMethod as ExtractedDocument['extractionMethod'])
    || !Array.isArray(value.blocks)
    || !Array.isArray(value.warnings)
    || !value.warnings.every(validIssue)
  ) {
    return { ok: false, error: { code: 'INVALID_DOCUMENT', message: 'Document shape is invalid.' } };
  }
  if (!value.blocks.every(validBlock)) {
    return { ok: false, error: { code: 'INVALID_BLOCK', message: 'Document contains an invalid block.' } };
  }

  const blocks = value.blocks as DocumentBlock[];
  const blockIds = new Set(blocks.map((block) => block.id));
  if (blockIds.size !== blocks.length) {
    return { ok: false, error: { code: 'INVALID_BLOCK', message: 'Document block IDs must be unique.' } };
  }
  if (!blocks.some(blockHasContent)) {
    return { ok: false, error: { code: 'EMPTY_INPUT', message: 'Document contains no processable content.' } };
  }

  return {
    ok: true,
    document: {
      version: 1,
      fileName: sanitizePreprocessFileName(value.fileName),
      sourceFormat: value.sourceFormat,
      extractionMethod: value.extractionMethod as ExtractedDocument['extractionMethod'],
      blocks: blocks.map(cloneBlock),
      warnings: (value.warnings as PreprocessIssue[]).map((warning) => ({
        ...warning,
        ...(warning.locations ? { locations: [...warning.locations] } : {}),
      })),
    },
  };
}

/** Strictly validates and normalizes the public preprocessing request contract. */
export function normalizePreprocessRequest(input: unknown): PreprocessRequestResult {
  if (!isRecord(input)) {
    return failure('INVALID_REQUEST', 'Request body must be an object.');
  }
  if (hasOwn(input, 'separator') && input.separator !== undefined && input.separator !== MISO_SEPARATOR) {
    return failure('INVALID_SEPARATOR', `Separator must be exactly "${MISO_SEPARATOR}".`);
  }

  let document: ExtractedDocument;
  if (hasOwn(input, 'document') && input.document !== undefined) {
    const normalized = normalizeDocument(input.document);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    document = normalized.document;
  } else if (hasOwn(input, 'text')) {
    if (typeof input.text !== 'string') {
      return failure('INVALID_REQUEST', 'Legacy text input must be a string.');
    }
    if (input.text.trim().length === 0) {
      return failure('EMPTY_INPUT', 'Text input must not be empty.');
    }
    document = {
      version: 1,
      fileName: 'document.txt',
      sourceFormat: 'txt',
      extractionMethod: 'local-text',
      blocks: [{
        id: 'raw-text-1',
        kind: 'raw-text',
        order: 0,
        headingPath: [],
        text: input.text,
      }],
      warnings: [],
    };
  } else {
    return failure('MISSING_INPUT', 'A structured document or legacy text input is required.');
  }

  return {
    ok: true,
    value: {
      document,
      docType: normalizeDocType(input.docType),
      separator: MISO_SEPARATOR,
    },
  };
}
