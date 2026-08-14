import {
  type ExtractedDocument,
  type PreprocessIssue,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './preprocessing/contracts.ts';
import {
  extractDocxDocument,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './docx-extractor.ts';
import {
  requestPdfUploadTicket,
  uploadPdfWithTus,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './supabase-pdf-uploader.ts';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type PdfStager = (
  file: File,
  fetchImpl: FetchImpl,
  signal?: AbortSignal,
) => Promise<string>;

interface DocxFile {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface DocxExtractionAdapters {
  local?: (buffer: ArrayBuffer, fileName: string) => Promise<ExtractedDocument>;
  miso?: (file: File, signal?: AbortSignal) => Promise<ExtractedDocument>;
}

interface ApiBody {
  success?: unknown;
  error?: unknown;
  message?: unknown;
  fileId?: unknown;
  fileName?: unknown;
  data?: {
    result?: unknown;
  };
}

function sourceFormat(fileName: string): string {
  const match = /\.([^.]+)$/u.exec(fileName.trim());
  return match?.[1]?.toLowerCase() || 'unknown';
}

function envelopeMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const envelope = value as Record<string, unknown>;
  return envelopeMessage(envelope.message)
    ?? envelopeMessage(envelope.error)
    ?? envelopeMessage(envelope.details);
}

async function readApiBody(response: Response): Promise<ApiBody> {
  if (typeof response.text === 'function') {
    const rawBody = await response.text();
    if (!rawBody.trim()) return {};
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed as ApiBody
        : { error: parsed };
    } catch {
      return { error: rawBody };
    }
  }
  return await response.json() as ApiBody;
}

function apiMessage(body: ApiBody, fallback: string): string {
  return envelopeMessage(body.error) ?? envelopeMessage(body.message) ?? fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(): Error {
  const error = new Error('File extraction was aborted.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (completion: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      completion();
    };
    const onAbort = (): void => settle(() => reject(abortError()));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    promise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

async function stagePdfInSupabase(
  file: File,
  fetchImpl: FetchImpl,
  signal?: AbortSignal,
): Promise<string> {
  const ticket = await requestPdfUploadTicket(file, fetchImpl, signal);
  await uploadPdfWithTus(file, ticket, signal);
  return ticket.path;
}

/** Performs the existing two-request MISO file extraction flow without UI state. */
export async function extractTextViaMiso(
  file: File,
  fetchImpl: FetchImpl = fetch,
  signal?: AbortSignal,
  stagePdf: PdfStager = stagePdfInSupabase,
): Promise<ExtractedDocument> {
  throwIfAborted(signal);
  let uploadResponse: Response;
  if (sourceFormat(file.name) === 'pdf') {
    const storagePath = await raceWithAbort(stagePdf(file, fetchImpl, signal), signal);
    throwIfAborted(signal);
    uploadResponse = await fetchImpl('/api/miso/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storagePath, fileName: file.name }),
      signal,
    });
  } else {
    const uploadBody = new FormData();
    uploadBody.append('file', file);
    uploadResponse = await fetchImpl('/api/miso/upload', {
      method: 'POST',
      body: uploadBody,
      signal,
    });
  }
  throwIfAborted(signal);
  const uploadResult = await raceWithAbort(readApiBody(uploadResponse), signal);
  throwIfAborted(signal);
  const uploadError = envelopeMessage(uploadResult.error);
  if (!uploadResponse.ok || uploadResult.success === false || uploadError) {
    throw new Error(uploadError ?? apiMessage(uploadResult, 'File upload failed.'));
  }

  const workflowResponse = await fetchImpl('/api/miso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileId: uploadResult.fileId,
      fileName: uploadResult.fileName,
    }),
    signal,
  });
  throwIfAborted(signal);
  const workflowResult = await raceWithAbort(readApiBody(workflowResponse), signal);
  throwIfAborted(signal);
  const workflowError = envelopeMessage(workflowResult.error);
  if (!workflowResponse.ok || workflowResult.success === false || workflowError) {
    throw new Error(workflowError ?? apiMessage(workflowResult, 'File extraction failed.'));
  }
  const text = workflowResult.data?.result;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('MISO extraction returned an empty result.');
  }

  return {
    version: 1,
    fileName: file.name,
    sourceFormat: sourceFormat(file.name),
    extractionMethod: 'miso',
    blocks: [{
      id: 'miso-block-1',
      kind: 'raw-text',
      order: 0,
      headingPath: [],
      text,
    }],
    warnings: [],
  };
}

/** Uses local DOCX extraction first and invokes MISO at most once as fallback. */
export async function extractDocxPreferLocal(
  file: File & DocxFile,
  adapters: DocxExtractionAdapters = {},
  signal?: AbortSignal,
): Promise<ExtractedDocument> {
  const local = adapters.local ?? extractDocxDocument;
  const miso = adapters.miso
    ?? ((candidate: File, abortSignal?: AbortSignal) => (
      extractTextViaMiso(candidate, fetch, abortSignal)
    ));
  let localFailure: unknown;

  try {
    throwIfAborted(signal);
    const localExtraction = (async () => {
      const buffer = await raceWithAbort(file.arrayBuffer(), signal);
      throwIfAborted(signal);
      return local(buffer, file.name);
    })();
    return await raceWithAbort(localExtraction, signal);
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw isAbortError(error) ? error : abortError();
    }
    localFailure = error;
  }

  try {
    throwIfAborted(signal);
    const document = await raceWithAbort(miso(file, signal), signal);
    throwIfAborted(signal);
    const warning: PreprocessIssue = {
      code: 'DOCX_FALLBACK',
      severity: 'warning',
      message: `Local DOCX extraction failed; MISO fallback was used: ${errorMessage(localFailure)}`,
    };
    return { ...document, warnings: [...document.warnings, warning] };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw isAbortError(error) ? error : abortError();
    }
    const misoFailure = error instanceof Error ? error : new Error(String(error));
    Object.defineProperty(misoFailure, 'localError', {
      configurable: true,
      enumerable: true,
      value: errorMessage(localFailure),
    });
    if (misoFailure.cause === undefined) {
      Object.defineProperty(misoFailure, 'cause', {
        configurable: true,
        value: localFailure,
      });
    }
    throw misoFailure;
  }
}
