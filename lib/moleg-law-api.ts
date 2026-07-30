import type {
  MolegLawDetailResult,
  MolegLawSearchItem,
  MolegLawSearchResult,
} from './moleg-law-types';
import type {
  ExtractedDocument,
  PreprocessIssue,
} from './preprocessing/contracts';

const MOLEG_API_BASE_URL = 'https://www.law.go.kr/DRF';
const SEARCH_PAGE_SIZE = 20;
const REQUEST_TIMEOUT_MS = 30_000;

type UnknownRecord = Record<string, unknown>;

export class MolegApiConfigurationError extends Error {
  constructor() {
    super('법제처 API 인증값이 설정되지 않았습니다.');
    this.name = 'MolegApiConfigurationError';
  }
}

export class MolegApiResponseError extends Error {
  constructor(message = '법제처 API 응답을 처리할 수 없습니다.') {
    super(message);
    this.name = 'MolegApiResponseError';
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value.flatMap(asList) : [value];
}

function scalar(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (!isRecord(value)) return '';
  for (const key of ['content', '_text', 'value', 'name']) {
    const candidate = scalar(value[key]);
    if (candidate) return candidate;
  }
  for (const candidate of Object.values(value)) {
    const text = scalar(candidate);
    if (text) return text;
  }
  return '';
}

function integer(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(scalar(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function decodeEntities(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decoded
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&amp;', '&');
  }
  return decoded;
}

function cleanBlock(value: unknown): string {
  const text = typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
  return decodeEntities(text)
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/gu, ''))
    .join('\n')
    .trim();
}

function flattenContent(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(flattenContent);
  const block = cleanBlock(value);
  return block ? [block] : [];
}

function readSearchItem(value: unknown): MolegLawSearchItem | null {
  const record = asRecord(value);
  const mst = scalar(record['법령일련번호']);
  const name = scalar(record['법령명한글']);
  const effectiveDate = scalar(record['시행일자']);
  if (!mst || !name || !effectiveDate) return null;
  return {
    mst,
    lawId: scalar(record['법령ID']),
    name,
    lawType: scalar(record['법령구분명']),
    ministry: scalar(record['소관부처명']),
    promulgationDate: scalar(record['공포일자']),
    promulgationNumber: scalar(record['공포번호']),
    effectiveDate,
    revisionType: scalar(record['제개정구분명']),
  };
}

export function parseLawSearchResponse(payload: unknown): MolegLawSearchResult {
  const root = asRecord(asRecord(payload).LawSearch);
  const resultCode = scalar(root.resultCode);
  if (resultCode && resultCode !== '00') {
    throw new MolegApiResponseError('법령 검색 요청이 실패했습니다.');
  }
  return {
    items: asList(root.law).map(readSearchItem).filter((item): item is MolegLawSearchItem => item !== null),
    totalCount: integer(root.totalCnt, 0),
    page: integer(root.page, 1),
    pageSize: integer(root.numOfRows, SEARCH_PAGE_SIZE),
  };
}

function articleBlocks(law: UnknownRecord): string[] {
  const articleRoot = asRecord(law['조문']);
  const blocks: string[] = [];
  for (const unitValue of asList(articleRoot['조문단위'])) {
    const unit = asRecord(unitValue);
    const unitLines: string[] = [];
    const article = cleanBlock(unit['조문내용']);
    if (article) unitLines.push(article);
    for (const paragraphValue of asList(unit['항'])) {
      const paragraph = asRecord(paragraphValue);
      const paragraphText = cleanBlock(paragraph['항내용']);
      if (paragraphText) unitLines.push(paragraphText);
      for (const subparagraphValue of asList(paragraph['호'])) {
        const subparagraph = asRecord(subparagraphValue);
        const subparagraphText = cleanBlock(subparagraph['호내용']);
        if (subparagraphText) unitLines.push(subparagraphText);
        for (const itemValue of asList(subparagraph['목'])) {
          const item = asRecord(itemValue);
          const itemText = cleanBlock(item['목내용']);
          if (itemText) unitLines.push(itemText);
        }
      }
    }
    if (unitLines.length > 0) blocks.push(unitLines.join('\n'));
  }
  return blocks;
}

function addendumBlocks(law: UnknownRecord): string[] {
  const addendumRoot = asRecord(law['부칙']);
  return asList(addendumRoot['부칙단위']).flatMap((value) => {
    const unit = asRecord(value);
    const content = flattenContent(unit['부칙내용']);
    return content.length > 0 ? [content.join('\n')] : [];
  });
}

function displayAppendixNumber(value: unknown): string {
  const raw = scalar(value);
  if (!/^\d+$/u.test(raw)) return raw;
  return String(Number.parseInt(raw, 10));
}

function appendixBlocks(law: UnknownRecord): {
  blocks: string[];
  warnings: PreprocessIssue[];
} {
  const appendixRoot = asRecord(law['별표']);
  const blocks: string[] = [];
  let missingTextCount = 0;
  for (const value of asList(appendixRoot['별표단위'])) {
    const unit = asRecord(value);
    const content = flattenContent(unit['별표내용']);
    if (content.length > 0) {
      blocks.push(content.join('\n'));
      continue;
    }
    const kind = scalar(unit['별표구분']) === '서식' ? '별지' : '별표';
    const number = displayAppendixNumber(unit['별표번호']);
    const title = scalar(unit['별표제목']) || scalar(unit['별표제목문자열']);
    if (number || title) blocks.push(`[${kind}${number ? ` ${number}` : ''}]${title ? ` ${title}` : ''}`);
    missingTextCount += 1;
  }
  return {
    blocks,
    warnings: missingTextCount > 0 ? [{
      code: 'LAW_API_APPENDIX_TEXT_MISSING',
      severity: 'warning',
      message: '일부 별표·별지는 법제처 API에서 텍스트 본문이 제공되지 않아 제목만 가져왔습니다.',
      count: missingTextCount,
    }] : [],
  };
}

function infoLine(label: string, value: string): string | null {
  return value ? `${label}: ${value}` : null;
}

function safeLawFileName(name: string): string {
  const sanitized = name.replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '_').trim();
  return `${sanitized || '법령'}.txt`;
}

export function parseLawDetailResponse(payload: unknown): MolegLawDetailResult {
  const law = asRecord(asRecord(payload)['법령']);
  if (Object.keys(law).length === 0) {
    throw new MolegApiResponseError('법령 본문을 찾을 수 없습니다.');
  }
  const basic = asRecord(law['기본정보']);
  const name = scalar(basic['법령명_한글']);
  if (!name) throw new MolegApiResponseError('법령 본문에서 법령명을 확인할 수 없습니다.');

  const info = [
    infoLine('법령구분', scalar(basic['법종구분'])),
    infoLine('소관부처', scalar(basic['소관부처'])),
    infoLine('공포일자', scalar(basic['공포일자'])),
    infoLine('공포번호', scalar(basic['공포번호'])),
    infoLine('시행일자', scalar(basic['시행일자'])),
  ].filter((line): line is string => line !== null);
  const appendices = appendixBlocks(law);
  const sections = [
    [name, info.length > 0 ? `[법령 정보]\n${info.join('\n')}` : ''].filter(Boolean).join('\n'),
    ...articleBlocks(law),
    ...addendumBlocks(law),
    ...appendices.blocks,
  ].filter((section) => section.trim().length > 0);
  const text = sections.join('\n\n');
  if (!text.trim()) throw new MolegApiResponseError('가져올 수 있는 법령 본문이 없습니다.');

  const document: ExtractedDocument = {
    version: 1,
    fileName: safeLawFileName(name),
    sourceFormat: 'law-api',
    extractionMethod: 'law-api',
    blocks: [{
      id: 'law-api-1',
      kind: 'raw-text',
      order: 0,
      headingPath: [],
      text,
    }],
    warnings: appendices.warnings,
  };
  return { name, text, document };
}

function apiKey(explicit?: string): string {
  const value = explicit ?? process.env.MOLEG_API_OC ?? '';
  if (!value.trim()) throw new MolegApiConfigurationError();
  return value.trim();
}

async function fetchJson(url: URL, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new MolegApiResponseError('법제처 API에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (!response.ok) {
    throw new MolegApiResponseError(`법제처 API가 오류 상태(${response.status})를 반환했습니다.`);
  }
  try {
    return await response.json();
  } catch {
    throw new MolegApiResponseError('법제처 API가 올바른 JSON을 반환하지 않았습니다.');
  }
}

export async function searchCurrentLaws(
  query: string,
  page = 1,
  options: { fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<MolegLawSearchResult> {
  const url = new URL(`${MOLEG_API_BASE_URL}/lawSearch.do`);
  url.search = new URLSearchParams({
    OC: apiKey(options.apiKey),
    target: 'eflaw',
    type: 'JSON',
    search: '1',
    nw: '3',
    query,
    display: String(SEARCH_PAGE_SIZE),
    page: String(page),
  }).toString();
  return parseLawSearchResponse(await fetchJson(url, options.fetchImpl ?? fetch));
}

export async function fetchCurrentLaw(
  mst: string,
  effectiveDate: string,
  options: { fetchImpl?: typeof fetch; apiKey?: string } = {},
): Promise<MolegLawDetailResult> {
  const url = new URL(`${MOLEG_API_BASE_URL}/lawService.do`);
  url.search = new URLSearchParams({
    OC: apiKey(options.apiKey),
    target: 'eflaw',
    type: 'JSON',
    MST: mst,
    efYd: effectiveDate,
  }).toString();
  return parseLawDetailResponse(await fetchJson(url, options.fetchImpl ?? fetch));
}
