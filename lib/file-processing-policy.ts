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

export type FileTransmissionPolicy = 'never' | 'on-local-failure' | 'always' | 'unsupported';

export interface FileProcessingDisclosure {
  title: string;
  extractionLabel: string;
  transmission: FileTransmissionPolicy;
  transmissionLabel: string;
  message: string;
  buttonLabel: string;
}

export const FILE_PROCESSING_DISCLOSURES: Readonly<Record<
  FileProcessingRoute,
  FileProcessingDisclosure
>> = {
  'local-text': {
    title: '브라우저에서 처리',
    extractionLabel: '브라우저에서 바로 읽음',
    transmission: 'never',
    transmissionLabel: '전송 안 함',
    message: '이 파일은 브라우저에서 직접 읽으며 원본 파일을 MISO로 전송하지 않습니다. 파일은 50MB 이하만 업로드할 수 있으며, 크기와 형식에 따라 처리에 시간이 걸릴 수 있습니다.',
    buttonLabel: '텍스트 추출',
  },
  'local-excel': {
    title: '브라우저에서 처리',
    extractionLabel: '브라우저에서 변환',
    transmission: 'never',
    transmissionLabel: '전송 안 함',
    message: '이 엑셀 파일은 브라우저에서 변환하며 원본 파일을 MISO로 전송하지 않습니다. 파일은 50MB 이하만 업로드할 수 있으며, 크기와 형식에 따라 처리에 시간이 걸릴 수 있습니다.',
    buttonLabel: '텍스트 추출',
  },
  'local-docx': {
    title: '로컬 추출 우선',
    extractionLabel: '브라우저에서 우선 추출',
    transmission: 'on-local-failure',
    transmissionLabel: '실패 시 전송',
    message: 'DOCX는 먼저 브라우저에서 추출합니다. 로컬 추출이 실패하면 원본 파일을 MISO로 전송해 다시 시도합니다. 원본 파일을 전송하면 안 된다면 TXT로 변환한 뒤 업로드하세요. 파일은 50MB 이하만 업로드할 수 있으며, 크기와 형식에 따라 처리에 시간이 걸릴 수 있습니다.',
    buttonLabel: '텍스트 추출',
  },
  miso: {
    title: 'MISO로 전송',
    extractionLabel: 'MISO로 텍스트 추출',
    transmission: 'always',
    transmissionLabel: '항상 전송',
    message: '이 형식은 텍스트 추출을 위해 원본 파일을 MISO로 전송해 처리합니다. 파일은 50MB 이하만 업로드할 수 있으며, 크기와 형식에 따라 처리에 시간이 걸릴 수 있습니다.',
    buttonLabel: '텍스트 추출',
  },
  unsupported: {
    title: '지원하지 않는 형식',
    extractionLabel: '지원 안 함',
    transmission: 'unsupported',
    transmissionLabel: '처리 불가',
    message: '이 파일 형식은 지원하지 않습니다. TXT, DOCX, PDF 등 지원 형식으로 변환해 업로드하세요.',
    buttonLabel: '텍스트 추출',
  },
};

export function getFileProcessingDisclosure(
  route: FileProcessingRoute,
): FileProcessingDisclosure {
  return FILE_PROCESSING_DISCLOSURES[route];
}

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
