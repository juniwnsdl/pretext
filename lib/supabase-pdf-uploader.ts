'use client';

import { Upload } from 'tus-js-client';

import {
  TEMP_PDF_BUCKET,
  type PdfUploadTicket,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './pdf-upload-contract.ts';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface TusUploadOptions {
  endpoint: string;
  headers: Record<string, string>;
  metadata: Record<string, string>;
  chunkSize: number;
  retryDelays: number[];
  removeFingerprintOnSuccess: boolean;
  uploadDataDuringCreation: boolean;
  onError(error: Error): void;
  onSuccess(): void;
}

interface TusUploadInstance {
  start(): void;
  abort(shouldTerminate?: boolean): Promise<void>;
}

type TusUploadConstructor = new (
  file: File,
  options: TusUploadOptions,
) => TusUploadInstance;

function abortError(): Error {
  const error = new Error('PDF 업로드가 취소되었습니다.');
  error.name = 'AbortError';
  return error;
}

function ticketFrom(value: unknown): PdfUploadTicket {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('PDF 업로드 주소 응답이 올바르지 않습니다.');
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.path !== 'string'
    || !/^pending\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.pdf$/iu.test(candidate.path)
    || typeof candidate.token !== 'string'
    || candidate.token.length === 0
    || typeof candidate.uploadEndpoint !== 'string'
    || !candidate.uploadEndpoint.startsWith('https://')
  ) {
    throw new Error('PDF 업로드 주소 응답이 올바르지 않습니다.');
  }
  return {
    path: candidate.path,
    token: candidate.token,
    uploadEndpoint: candidate.uploadEndpoint,
  };
}

function responseError(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const envelope = value as Record<string, unknown>;
  return responseError(envelope.error) ?? responseError(envelope.message);
}

export async function requestPdfUploadTicket(
  file: File,
  fetchImpl: FetchImpl = fetch,
  signal?: AbortSignal,
): Promise<PdfUploadTicket> {
  if (signal?.aborted) throw abortError();
  const response = await fetchImpl('/api/miso/upload-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/pdf',
    }),
    signal,
  });
  const rawBody = await response.text();
  let body: unknown = {};
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      body = { error: rawBody };
    }
  }
  if (!response.ok) {
    throw new Error(responseError(body) ?? 'PDF 업로드 주소를 만들지 못했습니다.');
  }
  return ticketFrom(body);
}

export function uploadPdfWithTus(
  file: File,
  ticket: PdfUploadTicket,
  signal?: AbortSignal,
  UploadConstructor: TusUploadConstructor = Upload as unknown as TusUploadConstructor,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let upload: TusUploadInstance;
    const settle = (completion: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      completion();
    };
    const onAbort = (): void => {
      void upload.abort().finally(() => settle(() => reject(abortError())));
    };

    upload = new UploadConstructor(file, {
      endpoint: ticket.uploadEndpoint,
      headers: { 'x-signature': ticket.token },
      metadata: {
        bucketName: TEMP_PDF_BUCKET,
        objectName: ticket.path,
        contentType: 'application/pdf',
        cacheControl: '0',
      },
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      removeFingerprintOnSuccess: true,
      uploadDataDuringCreation: true,
      onError: (error) => settle(() => reject(error)),
      onSuccess: () => settle(resolve),
    });

    signal?.addEventListener('abort', onAbort, { once: true });
    upload.start();
  });
}
