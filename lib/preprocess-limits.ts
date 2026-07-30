export const PREPROCESS_MAX_DOCUMENT_BLOCKS = 10_000;
export const PREPROCESS_MAX_WARNINGS = 1_000;
export const PREPROCESS_MAX_HEADING_PATH_DEPTH = 64;
export const PREPROCESS_MAX_TABLE_ROWS = 20_000;
export const PREPROCESS_MAX_TABLE_COLUMNS = 512;
export const PREPROCESS_MAX_TABLE_CELLS = 300_000;
export const PREPROCESS_MAX_TABLE_MERGES = 10_000;
export const PREPROCESS_MAX_ISSUE_LOCATIONS = 10_000;
export const PREPROCESS_MAX_AGGREGATE_TEXT_LENGTH = 50_000_000;
export const PREPROCESS_MAX_AGGREGATE_STRUCTURE_ITEMS = 2_000_000;

const tableRowsLabel = PREPROCESS_MAX_TABLE_ROWS.toLocaleString('ko-KR');
const tableCellsLabel = PREPROCESS_MAX_TABLE_CELLS.toLocaleString('ko-KR');

export const EXCEL_PREPROCESS_LIMIT_GUIDANCE =
  `시트당 ${tableRowsLabel}행·${tableCellsLabel}셀을 초과하면 파일을 나눠 처리해 주세요.`;

export const EXCEL_PREPROCESS_HELP_GUIDANCE =
  `파일 용량과 별도로 ${EXCEL_PREPROCESS_LIMIT_GUIDANCE}`;

export function getUploadPreprocessLimitGuidance(route: string | null | undefined): string | null {
  return route === 'local-excel' ? EXCEL_PREPROCESS_LIMIT_GUIDANCE : null;
}

export const PREPROCESS_INPUT_TOO_LARGE_MESSAGE =
  `문서가 전처리 입력 제한을 초과했습니다. 엑셀은 시트당 ${tableRowsLabel}행·${tableCellsLabel}셀 이하로 나누고, 다른 문서는 파일을 여러 개로 분리해 다시 시도해 주세요.`;

export const PREPROCESS_TEXT_TOO_LARGE_MESSAGE =
  '텍스트가 전처리 입력 제한을 초과했습니다. 파일을 여러 개로 나눠 다시 시도해 주세요.';
