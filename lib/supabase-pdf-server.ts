import {
  MAX_PDF_FILE_SIZE_BYTES,
  createTemporaryPdfPath,
  parsePdfUploadRequest,
  storageResumableEndpoint,
  type PdfUploadRequest,
  type PdfUploadTicket,
// @ts-expect-error Node's type-stripping runtime requires the explicit .ts extension.
} from './pdf-upload-contract.ts';

interface StorageError {
  message: string;
}

export interface TemporaryPdfStorage {
  createSignedUploadUrl(path: string): Promise<{
    data: { token?: string } | null;
    error: StorageError | null;
  }>;
  download(path: string): Promise<{
    data: Blob | null;
    error: StorageError | null;
  }>;
  remove(paths: string[]): Promise<{
    data: unknown;
    error: StorageError | null;
  }>;
}

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const TEMPORARY_PDF_PATH = /^pending\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-[0-9a-f-]{27}\.pdf$/iu;

function safePdfFileName(value: string): string {
  const fileName = value.trim().split(/[\\/]/u).pop() ?? '';
  if (!fileName || !/\.pdf$/iu.test(fileName)) {
    throw new Error('PDF 파일 이름이 올바르지 않습니다.');
  }
  return fileName;
}

export async function createPdfUploadTicket(
  request: PdfUploadRequest,
  storage: Pick<TemporaryPdfStorage, 'createSignedUploadUrl'>,
  supabaseUrl: string,
  now: Date = new Date(),
  createId: () => string = () => crypto.randomUUID(),
): Promise<PdfUploadTicket> {
  parsePdfUploadRequest(request);
  const path = createTemporaryPdfPath(now, createId);
  const { data, error } = await storage.createSignedUploadUrl(path);
  if (error || !data?.token) {
    throw new Error(error?.message ?? 'PDF 업로드 토큰을 만들지 못했습니다.');
  }
  return {
    path,
    token: data.token,
    uploadEndpoint: storageResumableEndpoint(supabaseUrl),
  };
}

export interface StoredPdfMisoUploadOptions {
  storagePath: string;
  fileName: string;
  storage: Pick<TemporaryPdfStorage, 'download' | 'remove'>;
  misoEndpoint: string;
  apiKey: string;
  fetchImpl?: FetchImpl;
}

export async function uploadStoredPdfToMiso(
  options: StoredPdfMisoUploadOptions,
): Promise<{ fileId: string; fileName: string }> {
  const {
    storagePath,
    storage,
    misoEndpoint,
    apiKey,
    fetchImpl = fetch,
  } = options;
  if (!TEMPORARY_PDF_PATH.test(storagePath)) {
    throw new Error('임시 PDF 경로가 올바르지 않습니다.');
  }
  const fileName = safePdfFileName(options.fileName);

  try {
    const { data: pdf, error: downloadError } = await storage.download(storagePath);
    if (downloadError || !pdf) {
      throw new Error(downloadError?.message ?? '임시 PDF를 읽지 못했습니다.');
    }
    if (pdf.size > MAX_PDF_FILE_SIZE_BYTES) {
      throw new Error('PDF 파일은 50MB 이하만 처리할 수 있습니다.');
    }

    const formData = new FormData();
    formData.append('file', new File([pdf], fileName, { type: 'application/pdf' }));
    formData.append('user', 'rag-preprocessor');
    const response = await fetchImpl(`${misoEndpoint}/ext/v1/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    const rawBody = await response.text();
    if (!response.ok) {
      throw new Error(rawBody || `MISO 파일 업로드에 실패했습니다. (${response.status})`);
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      throw new Error('MISO 파일 업로드 응답이 올바르지 않습니다.');
    }
    const fileId = typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>).id
      : undefined;
    if (typeof fileId !== 'string' || !fileId) {
      throw new Error('MISO 파일 ID를 받지 못했습니다.');
    }
    return { fileId, fileName };
  } finally {
    try {
      const { error } = await storage.remove([storagePath]);
      if (error) console.error('[pdf-upload] Temporary PDF cleanup failed:', error.message);
    } catch (error) {
      console.error('[pdf-upload] Temporary PDF cleanup failed:', error);
    }
  }
}
