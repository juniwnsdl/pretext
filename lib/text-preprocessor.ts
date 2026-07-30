import {
  type DocumentBlock,
  type ExtractedDocument,
  type PreprocessResult,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './preprocessing/contracts.ts';
import {
  finalizeChunkDrafts,
  prepareSourceText,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './preprocessing/core.ts';
import {
  chunkGeneralDocument,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './preprocessing/general-chunker.ts';
import {
  chunkContractDocument,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './preprocessing/contract-chunker.ts';
import {
  chunkWorkbookDocument,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './preprocessing/excel-chunker.ts';
import {
  chunkDelegationManualDocument,
  chunkLawDocument,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './preprocessing/law-chunker.ts';
import {
  chunkManualDocument,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './preprocessing/manual-chunker.ts';

export type { PreprocessResult } from './preprocessing/contracts.ts';

export type DocType = 'law' | 'excel' | 'manual' | 'general';

export interface PreprocessOptions {
  documentName?: string;
}

/** Converts legacy and unknown document type values to the public four-type contract. */
export function normalizeDocType(docType: unknown): DocType {
  if (docType === 'law' || docType === 'excel' || docType === 'manual' || docType === 'general') {
    return docType;
  }
  if (docType === 'research_paper') return 'manual';
  if (docType === 'other') return 'general';
  return 'general';
}

function blockSourceLength(block: DocumentBlock): number {
  if (block.kind !== 'table') return block.text?.length ?? 0;
  return (block.rows ?? []).reduce(
    (total, row) => total + row.reduce((rowTotal, cell) => rowTotal + cell.length, 0),
    0,
  );
}

function documentSourceLength(document: ExtractedDocument): number {
  return document.blocks.reduce((total, block) => total + blockSourceLength(block), 0);
}

/** Routes an already extracted document through one structure-aware chunker and the common finalizer. */
export function preprocessExtractedDocument(
  document: ExtractedDocument,
  docType: DocType,
): PreprocessResult {
  const originalLength = documentSourceLength(document);
  const preparationWarnings: ExtractedDocument['warnings'] = [];
  const preparedDocument: ExtractedDocument = {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.kind !== 'raw-text' || block.text === undefined) return block;
      const prepared = prepareSourceText(block.text);
      preparationWarnings.push(...prepared.warnings);
      return { ...block, text: prepared.text };
    }),
    warnings: [...document.warnings, ...preparationWarnings],
  };
  const compatibilityOutput = docType === 'excel'
    ? null
    : chunkDelegationManualDocument(preparedDocument);
  const output = compatibilityOutput ?? (() => {
    switch (docType) {
      case 'law':
        return chunkLawDocument(preparedDocument);
      case 'manual':
        return chunkManualDocument(preparedDocument);
      case 'excel':
        return chunkWorkbookDocument(preparedDocument);
      case 'general':
      default:
        return chunkContractDocument(preparedDocument) ?? chunkGeneralDocument(preparedDocument);
    }
  })();

  return finalizeChunkDrafts({
    originalLength,
    ...output,
  });
}

function documentNameFromOptions(options: PreprocessOptions | string): string {
  if (typeof options === 'object' && options.documentName?.trim()) {
    return options.documentName.trim();
  }
  return '텍스트 문서.txt';
}

function validateLegacySeparator(options: PreprocessOptions | string): void {
  if (typeof options === 'string' && options !== '' && options !== '@@@') {
    throw new TypeError("Legacy separator must be an empty string or exactly '@@@'.");
  }
}

/** Compatible flat-text façade. Only empty and `@@@` legacy separator strings are accepted. */
export function preprocessByDocType(
  text: string,
  docType: DocType,
  options: PreprocessOptions | string = {},
): PreprocessResult {
  validateLegacySeparator(options);
  const document: ExtractedDocument = {
    version: 1,
    fileName: documentNameFromOptions(options),
    sourceFormat: 'txt',
    extractionMethod: 'local-text',
    blocks: [{
      id: 'raw-text-1',
      kind: 'raw-text',
      order: 0,
      headingPath: [],
      text,
    }],
    warnings: [],
  };
  return preprocessExtractedDocument(document, normalizeDocType(docType));
}

/** Legacy general-document entry point retained for existing callers. */
export function preprocessText(text: string, separator: string = '@@@'): PreprocessResult {
  return preprocessByDocType(text, 'general', separator);
}
