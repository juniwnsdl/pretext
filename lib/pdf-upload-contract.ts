export const TEMP_PDF_BUCKET = 'temp-pdfs';
export const MAX_PDF_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export interface PdfUploadRequest {
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface PdfUploadTicket {
  path: string;
  token: string;
  uploadEndpoint: string;
}

export function parsePdfUploadRequest(value: unknown): PdfUploadRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('PDF 업로드 정보가 올바르지 않습니다.');
  }

  const candidate = value as Record<string, unknown>;
  const fileName = typeof candidate.fileName === 'string'
    ? candidate.fileName.trim()
    : '';
  const fileSize = candidate.fileSize;
  const mimeType = typeof candidate.mimeType === 'string'
    ? candidate.mimeType.trim().toLowerCase()
    : '';

  if (!fileName || !/\.pdf$/iu.test(fileName)) {
    throw new Error('PDF 파일만 업로드할 수 있습니다.');
  }
  if (!Number.isInteger(fileSize) || (fileSize as number) <= 0) {
    throw new Error('PDF 파일 크기가 올바르지 않습니다.');
  }
  if ((fileSize as number) > MAX_PDF_FILE_SIZE_BYTES) {
    throw new Error('PDF 파일은 50MB 이하만 업로드할 수 있습니다.');
  }
  if (mimeType && mimeType !== 'application/pdf') {
    throw new Error('PDF 파일 형식이 올바르지 않습니다.');
  }

  return {
    fileName,
    fileSize: fileSize as number,
    mimeType: 'application/pdf',
  };
}

export function createTemporaryPdfPath(
  now: Date = new Date(),
  createId: () => string = () => crypto.randomUUID(),
): string {
  const date = now.toISOString().slice(0, 10);
  return `pending/${date}/${createId()}.pdf`;
}

export function storageResumableEndpoint(supabaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    throw new Error('Supabase 프로젝트 URL이 올바르지 않습니다.');
  }

  const match = /^([a-z0-9-]+)\.supabase\.co$/iu.exec(url.hostname);
  if (url.protocol !== 'https:' || !match) {
    throw new Error('Supabase 프로젝트 URL이 올바르지 않습니다.');
  }

  return `https://${match[1]}.storage.supabase.co/storage/v1/upload/resumable/sign`;
}
