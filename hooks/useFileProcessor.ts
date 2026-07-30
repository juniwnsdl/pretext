import { useCallback, useRef, useState } from 'react';

import {
  getFileExtension,
  getFileProcessingRoute,
  isFileSizeAllowed,
} from '@/lib/file-processing-policy';
import {
  extractDocxPreferLocal,
  extractTextViaMiso,
} from '@/lib/miso-file-extractor';
import {
  MISO_SEPARATOR,
  type DocumentBlock,
  type ExtractedDocument,
  type PreprocessIssue,
  type PreprocessResult,
} from '@/lib/preprocessing/contracts';
import { revalidateEditedChunks } from '@/lib/preprocessing/core';
import {
  decodeTextBuffer,
  type DecodedText,
} from '@/lib/text-file-decoder';
import {
  applyManualExcelHeaderRows,
  type ExcelHeaderRowUpdate,
} from '@/lib/excel-layout-settings';
import type { DocType } from '@/lib/text-preprocessor';

export type ProcessStats = PreprocessResult['stats'];
export type ProcessorStatus =
  | 'idle'
  | 'reading'
  | 'uploading'
  | 'processing'
  | 'complete'
  | 'error';

export interface UseFileProcessorReturn {
  file: File | null;
  inputText: string;
  processedText: string;
  processedChunks: string[];
  docType: DocType;
  separator: string;
  stats: ProcessStats | null;
  error: string | null;
  status: ProcessorStatus;
  sourceDocument: ExtractedDocument | null;
  result: PreprocessResult | null;
  textEncoding: 'utf-8' | 'euc-kr' | null;
  encodingReviewRequired: boolean;
  extractionIssues: PreprocessIssue[];

  setFile: (file: File | null) => void;
  setInputText: (text: string) => void;
  setDocType: (type: DocType) => void;
  setSeparator: (separator: string) => void;
  setProcessedText: (text: string) => void;
  updateChunks: (chunks: string[]) => void;
  reset: () => void;

  handleFileRead: (file: File) => Promise<void>;
  processText: () => Promise<void>;
  reprocessExcel: (updates: ExcelHeaderRowUpdate[]) => Promise<void>;
  redecodeText: (encoding: 'utf-8' | 'euc-kr') => Promise<void>;
}

interface RetainedTextFile {
  buffer: ArrayBuffer;
  fileName: string;
  format: 'txt' | 'csv';
}

interface ApplyExtractionOptions {
  encoding?: 'utf-8' | 'euc-kr' | null;
  encodingReviewRequired?: boolean;
}

interface PreprocessApiResponse {
  success?: boolean;
  data?: PreprocessResult;
  error?: string | { message?: unknown };
}

const STRUCTURE_DISCARDED_ISSUE: PreprocessIssue = {
  code: 'STRUCTURE_DISCARDED_AFTER_EDIT',
  severity: 'warning',
  message: 'Manual editing replaced the extracted structure with raw text.',
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String(error || fallback);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function abortError(): Error {
  const error = new Error('File processing was cancelled.');
  error.name = 'AbortError';
  return error;
}

function escapeMarkdownCell(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replace(/\r\n?|\n/gu, '<br>');
}

function renderTablePreview(block: DocumentBlock): string {
  const rows = block.rows ?? [];
  const width = rows.reduce((largest, row) => Math.max(largest, row.length), 0);
  if (width === 0) return '';
  const normalizedRows = rows.map((row) => Array.from(
    { length: width },
    (_, column) => escapeMarkdownCell(row[column] ?? ''),
  ));
  const header = normalizedRows[0] ?? Array.from({ length: width }, () => '');
  const body = normalizedRows.slice(1);
  const table = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
  const title = block.sheetName ?? block.headingPath.at(-1);
  return title ? `## ${title}\n\n${table}` : table;
}

/** Renders an editable preview while leaving the source blocks untouched. */
function renderDocumentPreview(document: ExtractedDocument): string {
  return [...document.blocks]
    .sort((left, right) => left.order - right.order)
    .map((block) => {
      if (block.kind === 'table') return renderTablePreview(block);
      if (block.kind === 'heading') {
        return `${'#'.repeat(block.level ?? 2)} ${block.text ?? ''}`;
      }
      if (block.kind === 'list-item') {
        const indentation = '  '.repeat(Math.max(0, block.depth ?? 0));
        return `${indentation}${block.ordered ? '1.' : '-'} ${block.text ?? ''}`;
      }
      return block.text ?? '';
    })
    .filter((preview) => preview.length > 0)
    .join('\n\n');
}

function rawTextDocument(
  fileName: string,
  sourceFormat: string,
  text: string,
  extractionMethod: ExtractedDocument['extractionMethod'],
  warnings: PreprocessIssue[],
): ExtractedDocument {
  return {
    version: 1,
    fileName,
    sourceFormat,
    extractionMethod,
    blocks: [{
      id: extractionMethod === 'user-edited' ? 'user-edited-1' : 'raw-text-1',
      kind: 'raw-text',
      order: 0,
      headingPath: [],
      text,
    }],
    warnings,
  };
}

function issueKey(issue: PreprocessIssue): string {
  return JSON.stringify([
    issue.code,
    issue.severity,
    issue.message,
    issue.count ?? null,
    issue.locations ?? null,
  ]);
}

function uniqueIssues(issues: PreprocessIssue[]): PreprocessIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = issueKey(issue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeResultIssues(
  result: PreprocessResult,
  additionalIssues: PreprocessIssue[],
): PreprocessResult {
  const issues = uniqueIssues([...result.issues, ...additionalIssues]);
  const resultStatus = result.resultStatus === 'blocked'
    || issues.some((issue) => issue.severity === 'error')
    ? 'blocked'
    : result.resultStatus === 'review' || issues.length > 0
      ? 'review'
      : 'ready';
  return {
    ...result,
    issues,
    resultStatus,
    canDownload: result.canDownload && resultStatus !== 'blocked',
  };
}

function documentSourceLength(document: ExtractedDocument | null, fallback: number): number {
  if (!document) return fallback;
  return document.blocks.reduce((total, block) => {
    if (block.kind !== 'table') return total + (block.text?.length ?? 0);
    return total + (block.rows ?? []).reduce(
      (rowTotal, row) => rowTotal + row.reduce((cellTotal, cell) => cellTotal + cell.length, 0),
      0,
    );
  }, 0);
}

function apiErrorMessage(payload: PreprocessApiResponse): string {
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
  if (
    typeof payload.error === 'object'
    && payload.error !== null
    && typeof payload.error.message === 'string'
    && payload.error.message.trim()
  ) {
    return payload.error.message;
  }
  return 'Preprocessing failed.';
}

function extractWorkbookInWorker(
  buffer: ArrayBuffer,
  fileName: string,
  signal: AbortSignal,
): Promise<ExtractedDocument> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/file.worker.ts', import.meta.url));
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    let settled = false;
    const settle = (completion: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      try {
        worker.terminate();
      } finally {
        completion();
      }
    };
    const onAbort = (): void => settle(() => reject(abortError()));

    worker.onmessage = (event: MessageEvent<{
      status?: unknown;
      document?: unknown;
      error?: unknown;
    }>) => {
      if (event.data?.status === 'success' && event.data.document) {
        settle(() => resolve(event.data.document as ExtractedDocument));
        return;
      }
      const message = typeof event.data?.error === 'string'
        ? event.data.error
        : String(event.data?.error ?? 'Excel worker returned an invalid response.');
      settle(() => reject(new Error(message)));
    };
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault?.();
      settle(() => reject(new Error(event.message || 'Excel worker failed.')));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    if (signal.aborted) {
      onAbort();
      return;
    }
    try {
      worker.postMessage({ type: 'excel', fileName, buffer }, [buffer]);
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
}

export function useFileProcessor(): UseFileProcessorReturn {
  const [file, setFileState] = useState<File | null>(null);
  const [inputText, setInputTextState] = useState('');
  const [processedText, setProcessedText] = useState('');
  const [processedChunks, setProcessedChunks] = useState<string[]>([]);
  const [stats, setStats] = useState<ProcessStats | null>(null);
  const [docType, setDocTypeState] = useState<DocType>('general');
  const [separator, setSeparatorState] = useState<string>(MISO_SEPARATOR);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ProcessorStatus>('idle');
  const [sourceDocument, setSourceDocument] = useState<ExtractedDocument | null>(null);
  const [result, setResult] = useState<PreprocessResult | null>(null);
  const [textEncoding, setTextEncoding] = useState<'utf-8' | 'euc-kr' | null>(null);
  const [encodingReviewRequired, setEncodingReviewRequired] = useState(false);
  const [extractionIssues, setExtractionIssues] = useState<PreprocessIssue[]>([]);

  const sourceDocumentRef = useRef<ExtractedDocument | null>(null);
  const textFileRef = useRef<RetainedTextFile | null>(null);
  const fileOperationRef = useRef(0);
  const fileAbortRef = useRef<AbortController | null>(null);
  const processOperationRef = useRef(0);
  const processAbortRef = useRef<AbortController | null>(null);

  const clearResult = useCallback(() => {
    setResult(null);
    setProcessedText('');
    setProcessedChunks([]);
    setStats(null);
  }, []);

  const invalidatePreprocessing = useCallback(() => {
    processOperationRef.current += 1;
    processAbortRef.current?.abort();
    processAbortRef.current = null;
  }, []);

  const clearSourceState = useCallback(() => {
    textFileRef.current = null;
    sourceDocumentRef.current = null;
    setSourceDocument(null);
    setInputTextState('');
    setTextEncoding(null);
    setEncodingReviewRequired(false);
    setExtractionIssues([]);
    clearResult();
  }, [clearResult]);

  const cancelPendingWork = useCallback(() => {
    fileOperationRef.current += 1;
    fileAbortRef.current?.abort();
    fileAbortRef.current = null;
    invalidatePreprocessing();
  }, [invalidatePreprocessing]);

  const applyExtraction = useCallback((
    document: ExtractedDocument,
    options: ApplyExtractionOptions = {},
  ): void => {
    invalidatePreprocessing();
    sourceDocumentRef.current = document;
    setSourceDocument(document);
    setInputTextState(renderDocumentPreview(document));
    setExtractionIssues(document.warnings);
    setTextEncoding(options.encoding ?? null);
    setEncodingReviewRequired(options.encodingReviewRequired ?? false);
    clearResult();
  }, [clearResult, invalidatePreprocessing]);

  const setFile = useCallback((newFile: File | null) => {
    cancelPendingWork();
    clearSourceState();
    setFileState(newFile);
    setError(null);
    setStatus('idle');
  }, [cancelPendingWork, clearSourceState]);

  const setDocType = useCallback((nextDocType: DocType) => {
    invalidatePreprocessing();
    setDocTypeState(nextDocType);
    clearResult();
    setError(null);
    setStatus('idle');
  }, [clearResult, invalidatePreprocessing]);

  const setSeparator = useCallback((_nextSeparator: string) => {
    setSeparatorState(MISO_SEPARATOR);
  }, []);

  const reset = useCallback(() => {
    cancelPendingWork();
    clearSourceState();
    setFileState(null);
    setError(null);
    setStatus('idle');
    setDocTypeState('general');
    setSeparatorState(MISO_SEPARATOR);
  }, [cancelPendingWork, clearSourceState]);

  const setInputText = useCallback((text: string) => {
    cancelPendingWork();
    const currentDocument = sourceDocumentRef.current;
    const warnings = uniqueIssues([
      ...(currentDocument?.warnings ?? []),
      STRUCTURE_DISCARDED_ISSUE,
    ]);
    const editedDocument = rawTextDocument(
      currentDocument?.fileName ?? file?.name ?? 'document.txt',
      currentDocument?.sourceFormat ?? (getFileExtension(file?.name ?? '') || 'txt'),
      text,
      'user-edited',
      warnings,
    );
    sourceDocumentRef.current = editedDocument;
    setSourceDocument(editedDocument);
    setInputTextState(text);
    setExtractionIssues(warnings);
    setEncodingReviewRequired(false);
    clearResult();
    setError(null);
    setStatus('idle');
  }, [cancelPendingWork, clearResult, file]);

  const handleFileRead = useCallback(async (selectedFile: File) => {
    cancelPendingWork();
    const operationId = fileOperationRef.current;
    clearSourceState();
    setFileState(selectedFile);
    setError(null);

    if (!isFileSizeAllowed(selectedFile.size)) {
      setError('File size exceeds the 50 MB limit.');
      setStatus('error');
      return;
    }

    const processingRoute = getFileProcessingRoute(selectedFile.name);
    if (processingRoute === 'unsupported') {
      setError('Unsupported file format. Convert it to a supported document or text format.');
      setStatus('error');
      return;
    }

    const controller = new AbortController();
    fileAbortRef.current = controller;
    setStatus(processingRoute === 'miso' ? 'uploading' : 'reading');
    const fileExtension = getFileExtension(selectedFile.name);

    try {
      let document: ExtractedDocument;
      let decoded: DecodedText | null = null;

      if (processingRoute === 'local-text') {
        const buffer = await selectedFile.arrayBuffer();
        if (controller.signal.aborted) throw abortError();
        const format = fileExtension === 'csv' ? 'csv' : 'txt';
        decoded = decodeTextBuffer(buffer, { choice: 'auto', format });
        textFileRef.current = { buffer, fileName: selectedFile.name, format };
        document = rawTextDocument(
          selectedFile.name,
          fileExtension || 'txt',
          decoded.text,
          'local-text',
          decoded.warnings,
        );
        if (format === 'csv') setDocTypeState('excel');
      } else if (processingRoute === 'local-excel') {
        const buffer = await selectedFile.arrayBuffer();
        if (controller.signal.aborted) throw abortError();
        document = await extractWorkbookInWorker(buffer, selectedFile.name, controller.signal);
        setDocTypeState('excel');
      } else if (processingRoute === 'local-docx') {
        document = await extractDocxPreferLocal(selectedFile, {}, controller.signal);
      } else {
        document = await extractTextViaMiso(selectedFile, fetch, controller.signal);
      }

      if (operationId !== fileOperationRef.current || controller.signal.aborted) return;
      applyExtraction(document, {
        encoding: decoded?.encoding ?? null,
        encodingReviewRequired: decoded?.reviewRequired ?? false,
      });
      setStatus('idle');
    } catch (caught) {
      if (operationId !== fileOperationRef.current || isAbortError(caught)) return;
      console.error('File processing error:', caught);
      setError(errorMessage(caught, 'File processing failed.'));
      setStatus('error');
    } finally {
      if (fileAbortRef.current === controller) fileAbortRef.current = null;
    }
  }, [applyExtraction, cancelPendingWork, clearSourceState]);

  const redecodeText = useCallback(async (encoding: 'utf-8' | 'euc-kr') => {
    const retained = textFileRef.current;
    if (!retained) {
      setError('No retained text buffer is available for decoding.');
      setStatus('error');
      return;
    }

    cancelPendingWork();
    try {
      const decoded = decodeTextBuffer(retained.buffer, {
        choice: encoding,
        format: retained.format,
      });
      const document = rawTextDocument(
        retained.fileName,
        retained.format,
        decoded.text,
        'local-text',
        decoded.warnings,
      );
      applyExtraction(document, {
        encoding: decoded.encoding,
        encodingReviewRequired: decoded.reviewRequired,
      });
      setError(null);
      setStatus('idle');
    } catch (caught) {
      setError(errorMessage(caught, 'Text decoding failed.'));
      setStatus('error');
    }
  }, [applyExtraction, cancelPendingWork]);

  const runPreprocess = useCallback(async (
    document: ExtractedDocument,
    nextDocType: DocType,
  ): Promise<void> => {
    invalidatePreprocessing();
    const operationId = processOperationRef.current;
    const controller = new AbortController();
    processAbortRef.current = controller;
    setStatus('processing');
    setError(null);

    try {
      const response = await fetch('/api/preprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document,
          docType: nextDocType,
          separator: MISO_SEPARATOR,
        }),
        signal: controller.signal,
      });
      const payload = await response.json() as PreprocessApiResponse;
      if (!response.ok || payload.success !== true || !payload.data) {
        throw new Error(apiErrorMessage(payload));
      }
      if (operationId !== processOperationRef.current || controller.signal.aborted) return;

      const mergedResult = mergeResultIssues(payload.data, extractionIssues);
      setResult(mergedResult);
      setProcessedText(mergedResult.processedText);
      setProcessedChunks(mergedResult.chunks);
      setStats(mergedResult.stats);
      setStatus('complete');
    } catch (caught) {
      if (operationId !== processOperationRef.current || isAbortError(caught)) return;
      setError(errorMessage(caught, 'Preprocessing failed.'));
      setStatus('error');
    } finally {
      if (processAbortRef.current === controller) processAbortRef.current = null;
    }
  }, [extractionIssues, invalidatePreprocessing]);

  const processText = useCallback(async () => {
    const document = sourceDocumentRef.current;
    if (!document || !inputText.trim()) {
      setError('There is no document content to preprocess.');
      return;
    }
    await runPreprocess(document, docType);
  }, [docType, inputText, runPreprocess]);

  const reprocessExcel = useCallback(async (updates: ExcelHeaderRowUpdate[]) => {
    const document = sourceDocumentRef.current;
    if (!document) {
      setError('There is no Excel workbook to reprocess.');
      return;
    }
    try {
      const updated = applyManualExcelHeaderRows(document, updates);
      sourceDocumentRef.current = updated;
      setSourceDocument(updated);
      await runPreprocess(updated, 'excel');
    } catch (caught) {
      setError(errorMessage(caught, 'Excel header settings are invalid.'));
      setStatus('error');
    }
  }, [runPreprocess]);

  const updateChunks = useCallback((newChunks: string[]) => {
    invalidatePreprocessing();
    const originalLength = result?.stats.originalLength
      ?? documentSourceLength(sourceDocumentRef.current, inputText.length);
    const validated = revalidateEditedChunks(newChunks, originalLength);
    const updatedResult = mergeResultIssues(validated, [
      ...extractionIssues,
      STRUCTURE_DISCARDED_ISSUE,
    ]);
    setResult(updatedResult);
    setProcessedText(updatedResult.processedText);
    setProcessedChunks(updatedResult.chunks);
    setStats(updatedResult.stats);
    setStatus('complete');
    setError(null);
  }, [extractionIssues, inputText.length, invalidatePreprocessing, result?.stats.originalLength]);

  return {
    file,
    inputText,
    processedText,
    processedChunks,
    docType,
    separator,
    stats,
    error,
    status,
    sourceDocument,
    result,
    textEncoding,
    encodingReviewRequired,
    extractionIssues,
    setFile,
    setInputText,
    setDocType,
    setSeparator,
    setProcessedText,
    updateChunks,
    reset,
    handleFileRead,
    processText,
    reprocessExcel,
    redecodeText,
  };
}
