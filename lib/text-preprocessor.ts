/**
 * RAG 시스템을 위한 텍스트 전처리 유틸리티
 * 중복 제거, 공백 정규화, 특수 문자 제거, 청킹 기능 제공
 */

export interface PreprocessResult {
  processedText: string;
  chunks: string[];
  stats: {
    originalLength: number;
    processedLength: number;
    chunkCount: number;
  };
}

// MISO RAG 투입을 위한 문서 유형
export type DocType = 'law' | 'excel' | 'manual' | 'general';

/**
 * 이전 버전의 문서 유형을 새 체계로 변환한다.
 */
export function normalizeDocType(docType: unknown): DocType {
  if (docType === 'law' || docType === 'excel' || docType === 'manual' || docType === 'general') {
    return docType;
  }

  if (docType === 'research_paper') return 'manual';
  if (docType === 'other') return 'general';

  return 'general';
}

/**
 * 공백 정규화 - 여러 줄바꿈과 연속 공백 정리
 */
function normalizeWhitespace(text: string): string {
  // 연속된 공백을 하나로
  text = text.replace(/ +/g, ' ');
  // 탭을 공백으로
  text = text.replace(/\t+/g, ' ');
  // 3개 이상의 연속 줄바꿈을 2개로 (문단 구분)
  text = text.replace(/\n{3,}/g, '\n\n');
  // 줄 시작/끝 공백 제거
  text = text.split('\n').map(line => line.trim()).join('\n');
  // 앞뒤 공백 제거
  return text.trim();
}

/**
 * 특수 문자 및 불필요한 정보 제거
 */
function removeSpecialCharacters(text: string): string {
  // 제어 문자 제거 (탭, 줄바꿈 제외)
  text = text.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
  // 깨진 유니코드 문자 제거
  text = text.replace(/[\uFFFD]/g, '');
  // 특수 공백 문자를 일반 공백으로
  text = text.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ');
  // 불필요한 특수 기호 제거 (단, 문장 부호는 유지)
  text = text.replace(/[​‌‍]/g, ''); // Zero-width characters
  
  return text;
}

/**
 * 개선된 재귀적 청킹 (Recursive Character Text Splitter)
 * - 구분자 우선순위: \n\n -> \n -> . -> 공백 -> 글자
 * - 청크 간 오버랩(Overlap) 지원으로 문맥 끊김 방지
 */
function chunkTextOptimized(
  text: string,
  maxChunkSize: number = 4000,
  overlapSize: number = 0
): string[] {
  const separators = ['\n\n', '\n', '.', ' ', ''];
  
  function splitRecursive(text: string, separatorIdx: number): string[] {
    const finalChunks: string[] = [];
    const separator = separators[separatorIdx];
    
    // 더 이상 나눌 구분자가 없거나, 텍스트가 이미 충분히 작으면 반환
    if (text.length <= maxChunkSize || separatorIdx >= separators.length) {
      return [text];
    }

    // 현재 구분자로 분할
    let parts: string[];
    if (separator === '') {
      parts = text.split('');
    } else if (separator === '.') {
      // 문침표는 뒤에 공백이 오는 경우를 주로 타겟팅 (단순화)
      parts = text.split('. ').map((p, i, arr) => i < arr.length - 1 ? p + '. ' : p);
    } else {
      parts = text.split(separator);
    }
    
    let currentDoc = '';
    
    for (let i = 0; i < parts.length; i++) {
      let part = parts[i];
      // 구분자 복원 (split으로 사라진 경우)
      if (separator === '\n\n' || separator === '\n') {
        // 줄바꿈은 뒤에 붙여주는 것이 자연스러움 (단, 마지막 조각 제외)
        if (i < parts.length - 1) part += separator;
      }
      
      // 현재 조각 하나가 이미 maxChunkSize보다 크면 -> 다음 단계 구분자로 더 깊게 들어감
      if (part.length > maxChunkSize) {
        // 지금까지 모은건 저장
        if (currentDoc) {
          finalChunks.push(currentDoc);
          currentDoc = '';
        }
        // 큰 조각은 재귀적으로 분할하여 추가
        finalChunks.push(...splitRecursive(part, separatorIdx + 1));
        continue;
      }

      // 병합 시도
      if (currentDoc.length + part.length > maxChunkSize) {
        if (currentDoc) {
           finalChunks.push(currentDoc);
           
           // Overlap 로직: 이전 청크의 끝부분을 가져와서 새 청크의 시작으로 삼음
           if (overlapSize > 0 && currentDoc.length > overlapSize) {
             // 단순히 뒤에서 자르면 단어가 잘릴 수 있으므로, 공백 기준으로 찾는게 좋지만
             // 여기선 단순화하여 길이로 처리하되, 앞부분 공백 제거
             currentDoc = currentDoc.slice(-overlapSize).trimStart(); 
           } else {
             currentDoc = '';
           }
        }
        currentDoc += part;
      } else {
        currentDoc += part;
      }
    }
    
    if (currentDoc) {
      finalChunks.push(currentDoc);
    }
    
    return finalChunks;
  }

  return splitRecursive(text, 0);
}

/**
 * 기존 단순 청킹 (하위 호환성 유지 또는 Fallback용)
 */
function chunkText(text: string, maxChunkSize: number = 4000): string[] {
  return chunkTextOptimized(text, maxChunkSize, 0); // 오버랩 없이 호출
}

type StructuredBlock = {
  heading: string | null;
  body: string;
};

type TextSplitter = (text: string, maxChunkSize: number) => string[];

/**
 * 제목 경계를 먼저 보존한 뒤 최대 크기에 맞춰 병합 또는 분할한다.
 */
function chunkStructuredText(
  text: string,
  isHeading: (line: string) => boolean,
  maxChunkSize: number = 4000,
  splitText: TextSplitter = chunkText
): string[] {
  const blocks: StructuredBlock[] = [];
  let currentHeading: string | null = null;
  let bodyLines: string[] = [];

  const flushBlock = () => {
    const body = bodyLines.join('\n').trim();
    if (currentHeading || body) {
      blocks.push({ heading: currentHeading, body });
    }
    bodyLines = [];
  };

  for (const line of text.split('\n')) {
    if (isHeading(line)) {
      flushBlock();
      currentHeading = line.trim();
    } else {
      bodyLines.push(line);
    }
  }
  flushBlock();

  const chunks: string[] = [];
  let mergeBuffer = '';

  const flushMergeBuffer = () => {
    if (mergeBuffer) chunks.push(mergeBuffer);
    mergeBuffer = '';
  };

  for (const block of blocks) {
    const rendered = [block.heading, block.body].filter(Boolean).join('\n');

    if (rendered.length > maxChunkSize) {
      flushMergeBuffer();

      if (!block.heading) {
        chunks.push(...splitText(block.body, maxChunkSize));
        continue;
      }

      const continuedHeading = `${block.heading} (계속)\n`;
      const bodyChunkSize = Math.max(100, maxChunkSize - continuedHeading.length);
      const bodyChunks = splitText(block.body, bodyChunkSize);

      for (let index = 0; index < bodyChunks.length; index++) {
        const heading = index === 0 ? block.heading : `${block.heading} (계속)`;
        chunks.push(`${heading}\n${bodyChunks[index]}`.trim());
      }
      continue;
    }

    const nextValue = mergeBuffer ? `${mergeBuffer}\n\n${rendered}` : rendered;
    if (nextValue.length <= maxChunkSize) {
      mergeBuffer = nextValue;
    } else {
      flushMergeBuffer();
      mergeBuffer = rendered;
    }
  }

  flushMergeBuffer();
  return chunks;
}

function isManualHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 100) return false;

  if (/^#{1,6}\s+\S+/.test(trimmed)) return true;
  if (/^제\s*\d+\s*[장절]\s*\S*/.test(trimmed)) return true;
  if (/^(?:개요|목적|대상|준비 사항|준비물|설치|설정|사용 방법|작업 절차|처리 절차|주의 사항|주의|경고|참고|문제 해결|오류 해결|자주 묻는 질문|FAQ)$/i.test(trimmed)) {
    return true;
  }

  const isNumberedHeading = /^(?:(?:\d+\.)+\d*|[IVX]+\.|[가-힣]\.)\s+\S+/.test(trimmed);
  const looksLikeInstruction = /(?:다|요|시오|세요)\.$/.test(trimmed);
  return isNumberedHeading && !looksLikeInstruction;
}

/**
 * 설명서와 업무 매뉴얼의 소제목 및 절차 구조 기반 청킹
 */
function chunkManual(text: string, maxChunkSize: number = 4000): string[] {
  const hasManualHeadings = text.split('\n').some(isManualHeading);
  if (!hasManualHeadings) {
    return chunkMarkdownWithTables(text, maxChunkSize, 0);
  }

  return chunkStructuredText(
    text,
    isManualHeading,
    maxChunkSize,
    (content, size) => chunkMarkdownWithTables(content, size, 0)
  );
}

/**
 * 법령, 계약조건, 사규 등에서 독립된 구조 제목으로 쓰이는 줄을 감지한다.
 * DOCX 목록 번호가 앞에 붙은 "1.1.70. 제1조(목적)" 형태도 허용한다.
 */
function isLegalStructureHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 120) return false;

  return /^(?:(?:\d+\.)+\s*)?(?:제\s*\d+(?:\s*의\s*\d+)?\s*(?:편|장|절|관|조)(?=\s|$|\()|부칙(?=\s|$|\()|별표(?:\s|$|\d)|별지(?:\s|$|\d))/.test(trimmed);
}

/**
 * 일반 문서도 명확한 조문 구조가 있으면 조문 경계를 우선 보존한다.
 * 구조가 없는 보고서나 일반 텍스트는 기존 문단/표 기반 청킹을 유지한다.
 */
function chunkGeneral(text: string, maxChunkSize: number = 4000): string[] {
  if (!text.split('\n').some(isLegalStructureHeading)) {
    return chunkMarkdownWithTables(text, maxChunkSize, 0);
  }

  return chunkStructuredText(
    text,
    isLegalStructureHeading,
    maxChunkSize,
    (content, size) => chunkMarkdownWithTables(content, size, 0)
  );
}

/**
 * 법령 및 규정 구조 기반 청킹
 * - "제N장", "제N조" 등의 구조를 파악하여 의미 단위 보존
 * - 구조가 없으면 일반 청킹으로 fallback
 */
function chunkLawStructure(text: string, maxChunkSize: number = 4000): string[] {
  if (!text.split('\n').some(isLegalStructureHeading)) {
    // 법령 구조가 아니면 일반 청킹 사용
    return chunkText(text, maxChunkSize);
  }

  return chunkStructuredText(text, isLegalStructureHeading, maxChunkSize, chunkText);
}

const DELEGATION_MANUAL_TITLE = '[위임전결규정 매뉴얼]';
const DELEGATION_CATEGORY_PATTERN = /^([A-J])\.\s+\S/;
const PAGE_MARKER_PATTERN = /^페이지\s*\d+\s*$/;

type DelegationCategoryMarker = {
  lineIndex: number;
  letter: string;
  title: string;
};

/**
 * 규정 본문 뒤에 A~J 표 매뉴얼이 이어지는 위임전결 문서를 감지하고,
 * 규정과 각 업무 카테고리를 서로 다른 청크로 보존한다.
 */
function chunkDelegationManualDocument(
  text: string,
  maxChunkSize: number = 4000
): string[] | null {
  const lines = text.split('\n');
  const manualTitleIndex = lines.findIndex(
    (line) => line.trim() === DELEGATION_MANUAL_TITLE
  );

  if (manualTitleIndex < 0) return null;

  const categoryMarkers: DelegationCategoryMarker[] = [];
  for (let lineIndex = manualTitleIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const title = lines[lineIndex].trim();
    const match = title.match(DELEGATION_CATEGORY_PATTERN);
    if (!match) continue;

    categoryMarkers.push({ lineIndex, letter: match[1], title });
  }

  const hasSequentialCategories =
    categoryMarkers.length >= 2 &&
    categoryMarkers[0].letter === 'A' &&
    categoryMarkers.every((marker, index) =>
      index === 0 ||
      marker.letter.charCodeAt(0) ===
        categoryMarkers[index - 1].letter.charCodeAt(0) + 1
    );
  const hasMarkdownTable = lines
    .slice(manualTitleIndex + 1)
    .some((line) => /^\s*\|.*---.*\|\s*$/.test(line));

  if (!hasSequentialCategories || !hasMarkdownTable) return null;

  const chunks: string[] = [];
  const regulationText = lines.slice(0, manualTitleIndex).join('\n').trim();
  if (regulationText) {
    chunks.push(...chunkText(regulationText, maxChunkSize));
  }

  for (let index = 0; index < categoryMarkers.length; index += 1) {
    const marker = categoryMarkers[index];
    const nextMarker = categoryMarkers[index + 1];
    const categoryBody = lines
      .slice(marker.lineIndex + 1, nextMarker?.lineIndex ?? lines.length)
      .filter((line) => !PAGE_MARKER_PATTERN.test(line.trim()))
      .join('\n')
      .trim();
    const categoryPrefix = `${DELEGATION_MANUAL_TITLE}\n${marker.title}`;
    const renderedCategory = categoryBody
      ? `${categoryPrefix}\n${categoryBody}`
      : categoryPrefix;

    if (renderedCategory.length <= maxChunkSize) {
      chunks.push(renderedCategory);
      continue;
    }

    const continuedPrefix = `${categoryPrefix} (계속)`;
    const bodyChunkSize = Math.max(
      100,
      maxChunkSize - continuedPrefix.length - 1
    );
    const bodyChunks = chunkMarkdownWithTables(categoryBody, bodyChunkSize, 0);

    for (let bodyIndex = 0; bodyIndex < bodyChunks.length; bodyIndex += 1) {
      const prefix = bodyIndex === 0 ? categoryPrefix : continuedPrefix;
      chunks.push(`${prefix}\n${bodyChunks[bodyIndex]}`.trim());
    }
  }

  return chunks;
}


/**
 * 공통 전처리 파이프라인 (청킹 전 단계까지)
 */
function basePreprocess(text: string): { originalLength: number; processed: string } {
  const originalLength = text.length;

  // 동일 문단도 업무상 의미가 있을 수 있으므로 내용 중복은 제거하지 않는다.
  let processed = text;

  // 1. 특수 문자 제거
  processed = removeSpecialCharacters(processed);

  // 2. 공백 정규화
  processed = normalizeWhitespace(processed);

  return { originalLength, processed };
}

/**
 * CSV 파서 (따옴표 처리 포함)
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++; // 따옴표 이스케이프 스킵
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        if (char === '\r') i++; // \n 스킵
      } else if (char === '\r') {
         // \n 없는 \r 처리
         currentRow.push(currentField);
         rows.push(currentRow);
         currentRow = [];
         currentField = '';
      } else {
        currentField += char;
      }
    }
  }
  // 마지막 필드/행 처리
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }
  return rows;
}

/**
 * 엑셀 파일 전용 전처리 (스마트 헤더 유지 & 행 단위 보존)
 * - CSV 파싱 후 마크다운 표로 변환
 * - 청크 분할 시 헤더를 자동으로 포함하여 문맥 유지
 */
function preprocessExcel(text: string, separator: string = '@@@'): PreprocessResult {
  // 1. 시트 분리
  const sheetRegex = /\[Sheet: (.*?)\]/g;
  const parts = text.split(sheetRegex);
  
  const chunks: string[] = [];
  const maxChunkSize = 4000;
  
  // 처리할 섹션 식별
  let sections: {name: string, content: string}[] = [];
  if (parts.length > 1) {
    for (let i = 1; i < parts.length; i += 2) {
      const sheetName = parts[i];
      const content = parts[i + 1];
      if (content && content.trim()) {
        sections.push({ name: sheetName, content });
      }
    }
  } else {
    sections.push({ name: 'Sheet1', content: text });
  }

  let currentChunk = '';

  for (const section of sections) {
    // CSV 파싱
    const rows = parseCSV(section.content.trim());
    if (rows.length === 0) continue;

    // 헤더 추출 (첫 번째 유효한 행)
    const headerRow = rows[0];
    const dataRows = rows.slice(1);
    
    // 마크다운 헤더 생성
    const mdHeader = 
      `| ${headerRow.map(c => c.trim().replace(/[\r\n]+/g, ' ')).join(' | ')} |\n` +
      `| ${headerRow.map(() => '---').join(' | ')} |`;
    
    // 시트 제목 추가
    const sheetTitle = `### Sheet: ${section.name}\n\n`;
    
    // 우선 현재 청크에 시트 제목을 넣을 수 있는지 확인
    if ((currentChunk + '\n\n' + sheetTitle).length > maxChunkSize) {
      chunks.push(currentChunk);
      currentChunk = '';
    }
    
    // 시트 제목 추가
    if (currentChunk === '') {
      currentChunk = sheetTitle + mdHeader;
    } else {
      currentChunk += '\n\n' + sheetTitle + mdHeader;
    }
    
    // 데이터 행 처리
    for (const row of dataRows) {
      // 빈 행 건너뛰기
      if (row.every(c => !c.trim())) continue;
      
      const mdRow = `| ${row.map(c => c.trim().replace(/[\r\n]+/g, ' ')).join(' | ')} |`;
      
      // 추가 시 크기 초과 확인
      if ((currentChunk + '\n' + mdRow).length > maxChunkSize) {
        // 현재 청크 저장
        chunks.push(currentChunk);
        
        // 새 청크 시작: 문맥 유지를 위해 시트 제목과 헤더를 다시 넣어줌
        currentChunk = `${sheetTitle.trim()} (continued)\n\n${mdHeader}\n${mdRow}`;
      } else {
        currentChunk += '\n' + mdRow;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  const processedText = chunks.join(`\n\n${separator}\n\n`);

  return {
    processedText,
    chunks,
    stats: {
      originalLength: text.length,
      processedLength: processedText.length,
      chunkCount: chunks.length,
    },
  };
}

/**
 * 전체 전처리 파이프라인 실행 (일반 문서용)
 */
export function preprocessText(text: string, separator: string = '@@@'): PreprocessResult {
  const { originalLength, processed } = basePreprocess(text);

  // 5. 청킹 (일반 문서: 문단/문장 기반)
  const chunks = chunkText(processed);

  // 청크를 구분자로 연결
  const processedText = chunks.join(`\n\n${separator}\n\n`);

  return {
    processedText,
    chunks,
    stats: {
      originalLength,
      processedLength: processed.length,
      chunkCount: chunks.length,
    },
  };
}

/**
 * 문서 유형별 전처리 파이프라인
 */
export function preprocessByDocType(
  text: string,
  docType: DocType,
  separator: string = '@@@'
): PreprocessResult {
  switch (docType) {
    case 'law': {
      const { originalLength, processed } = basePreprocess(text);
      const chunks =
        chunkDelegationManualDocument(processed) ??
        chunkLawStructure(processed);
      const processedText = chunks.join(`\n\n${separator}\n\n`);

      return {
        processedText,
        chunks,
        stats: {
          originalLength,
          processedLength: processed.length,
          chunkCount: chunks.length,
        },
      };
    }
    case 'manual': {
      const { originalLength, processed } = basePreprocess(text);
      const chunks =
        chunkDelegationManualDocument(processed) ??
        chunkManual(processed);
      const processedText = chunks.join(`\n\n${separator}\n\n`);

      return {
        processedText,
        chunks,
        stats: {
          originalLength,
          processedLength: processed.length,
          chunkCount: chunks.length,
        },
      };
    }
    case 'excel': {
      // 엑셀 파일: 헤더 보존 및 행 단위 청킹
      return preprocessExcel(text, separator);
    }
    case 'general':
    default: {
      const { originalLength, processed } = basePreprocess(text);
      // 표를 보존하고, 조문형 문서는 명확한 구조 경계도 함께 보존
      const chunks =
        chunkDelegationManualDocument(processed) ??
        chunkGeneral(processed);
      const processedText = chunks.join(`\n\n${separator}\n\n`);

      return {
        processedText,
        chunks,
        stats: {
          originalLength,
          processedLength: processed.length,
          chunkCount: chunks.length,
        },
      };
    }
  }
}

/**
 * 마크다운 표를 인식하여 청킹 (표가 잘리지 않도록 처리)
 */
function chunkMarkdownWithTables(
  text: string, 
  maxChunkSize: number = 4000,
  overlapSize: number = 0
): string[] {
  // 1. 텍스트를 줄 단위로 분리하여 블록(텍스트/표)으로 그룹화
  const lines = text.split('\n');
  const blocks: { type: 'text' | 'table'; content: string[] }[] = [];
  
  // 표 라인 감지 정규식 (파이프로 시작하고 파이프로 끝나는 형태, 혹은 파이프 포함)
  // 단순화: 라인 내에 |가 있고, 문맥상 표의 일부처럼 보이는 경우
  const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);

  let currentBlock: { type: 'text' | 'table'; content: string[] } | null = null;

  for (const line of lines) {
    if (isTableLine(line)) {
      if (currentBlock && currentBlock.type === 'table') {
        currentBlock.content.push(line);
      } else {
        // 새 표 블록 시작
        // 이전 텍스트 블록 종료 (자동 처리됨)
        blocks.push({ type: 'table', content: [line] });
        currentBlock = blocks[blocks.length - 1];
      }
    } else {
      if (currentBlock && currentBlock.type === 'text') {
        currentBlock.content.push(line);
      } else {
        // 새 텍스트 블록 시작
        blocks.push({ type: 'text', content: [line] });
        currentBlock = blocks[blocks.length - 1];
      }
    }
  }

  // 2. 블록별 청킹 처리
  const chunks: string[] = [];
  let currentChunk = '';

  for (const block of blocks) {
    if (block.type === 'text') {
      const textContent = block.content.join('\n').trim();
      if (!textContent) continue;

      // 텍스트 블록은 기존 최적화 청킹 로직 사용
      const textChunks = chunkTextOptimized(textContent, maxChunkSize, overlapSize);
      
      for (const chunk of textChunks) {
        if (currentChunk) {
          if (currentChunk.length + chunk.length + 2 <= maxChunkSize) {
            currentChunk += '\n\n' + chunk;
          } else {
            chunks.push(currentChunk);
            currentChunk = chunk;
          }
        } else {
          currentChunk = chunk;
        }
      }

    } else {
      // 표 블록 처리
      // 표가 유효한지 확인 (최소 2줄: 헤더 + 구분선)
      if (block.content.length < 2) {
        // 표가 아니거나 너무 짧으면 텍스트로 취급
        const textContent = block.content.join('\n');
        if (currentChunk.length + textContent.length + 2 <= maxChunkSize) {
          currentChunk += (currentChunk ? '\n\n' : '') + textContent;
        } else {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = textContent;
        }
        continue;
      }

      // 헤더와 구분선 식별
      const header = block.content[0];
      const separator = block.content[1];
      
      // 구분선이 | --- | 형태인지 확인 (간단한 체크)
      const isRealTable = separator.includes('---') || (separator.match(/\|/g) || []).length > 1;

      if (!isRealTable) {
        // 표 형식이 아니면 일반 텍스트로 처리
        const textContent = block.content.join('\n');
        // 일반 텍스트 청킹 로직 적용 (크기가 클 수 있으므로)
        const textChunks = chunkTextOptimized(textContent, maxChunkSize, overlapSize);
        for (const chunk of textChunks) {
           if (currentChunk.length + chunk.length + 2 <= maxChunkSize) {
              currentChunk += (currentChunk ? '\n\n' : '') + chunk;
           } else {
              if (currentChunk) chunks.push(currentChunk);
              currentChunk = chunk;
           }
        }
        continue;
      }

      // 진짜 표인 경우
      const wholeTable = block.content.join('\n');
      
      // 1. 현재 청크에 통째로 들어가는지 확인
      if (currentChunk.length + wholeTable.length + 2 <= maxChunkSize) {
        currentChunk += (currentChunk ? '\n\n' : '') + wholeTable;
        continue;
      }

      // 2. 들어가지 않으면 현재 청크 마감
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      // 3. 새 청크에 통째로 들어가는지 확인
      if (wholeTable.length <= maxChunkSize) {
        currentChunk = wholeTable;
        continue;
      }

      // 4. 표가 너무 크면 행 단위로 분할 (헤더 반복)
      const tableHeader = header + '\n' + separator;
      const rows = block.content.slice(2);
      
      let tempTableChunk = tableHeader;

      for (const row of rows) {
        if (tempTableChunk.length + row.length + 1 <= maxChunkSize) {
          tempTableChunk += '\n' + row;
        } else {
          // 꽉 차면 청크 저장
          chunks.push(tempTableChunk);
          // 새 청크 시작 (헤더 반복 + (continued) 표시)
          // (continued) 표시는 선택사항이지만 문맥 파악에 도움됨
          // 단, 마크다운 표 문법상 헤더 바로 뒤에 행이 와야 하므로 텍스트로 넣거나, 그냥 헤더만 반복
          tempTableChunk = tableHeader + '\n' + row; 
        }
      }
      
      // 남은 부분 처리
      if (tempTableChunk) {
        currentChunk = tempTableChunk;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}
