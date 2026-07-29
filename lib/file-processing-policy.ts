export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export const LOCAL_TEXT_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'log',
  'xml',
  'yml',
  'yaml',
] as const;

export const LOCAL_EXCEL_EXTENSIONS = ['xlsx', 'xls', 'ods'] as const;
export const LOCAL_DOCX_EXTENSIONS = ['docx'] as const;
export const MISO_DOCUMENT_EXTENSIONS = [
  'pdf',
  'html',
  'pptx',
  'ppt',
] as const;
export const MISO_IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
] as const;

export type FileProcessingRoute =
  | 'local-text'
  | 'local-excel'
  | 'local-docx'
  | 'miso'
  | 'unsupported';

const localTextExtensions = new Set<string>(LOCAL_TEXT_EXTENSIONS);
const localExcelExtensions = new Set<string>(LOCAL_EXCEL_EXTENSIONS);
const localDocxExtensions = new Set<string>(LOCAL_DOCX_EXTENSIONS);
const misoExtensions = new Set<string>([
  ...MISO_DOCUMENT_EXTENSIONS,
  ...MISO_IMAGE_EXTENSIONS,
]);

export function getFileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export function getFileProcessingRoute(fileName: string): FileProcessingRoute {
  const extension = getFileExtension(fileName);
  if (localTextExtensions.has(extension)) return 'local-text';
  if (localExcelExtensions.has(extension)) return 'local-excel';
  if (localDocxExtensions.has(extension)) return 'local-docx';
  if (misoExtensions.has(extension)) return 'miso';
  return 'unsupported';
}

export function isFileSizeAllowed(fileSize: number): boolean {
  return fileSize <= MAX_FILE_SIZE_BYTES;
}

export const FILE_INPUT_ACCEPT = [
  ...LOCAL_TEXT_EXTENSIONS,
  ...LOCAL_EXCEL_EXTENSIONS,
  ...LOCAL_DOCX_EXTENSIONS,
  ...MISO_DOCUMENT_EXTENSIONS,
  ...MISO_IMAGE_EXTENSIONS,
]
  .map((extension) => `.${extension}`)
  .join(',');
