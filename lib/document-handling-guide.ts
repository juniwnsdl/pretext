export type DocumentHandlingStage = {
  id: 'preprocessor' | 'split-and-retry' | 'assisted-processing';
  step: 1 | 2 | 3;
  title: string;
  description: string;
  examples: readonly string[];
};

export const DOCUMENT_HANDLING_STAGES: readonly DocumentHandlingStage[] = [
  {
    id: 'preprocessor',
    step: 1,
    title: '먼저, 이 전처리기를 사용하세요',
    description:
      '50MB 이하의 일반적인 엑셀·PDF·DOCX·설명서·법령 문서는 이 전처리기로 충분히 정리할 수 있습니다. 결과를 원문과 비교해 확인할 수 있다면 상용 AI를 별도로 사용할 필요가 없습니다.',
    examples: [
      '글자를 선택할 수 있는 일반 PDF와 문서',
      '관련된 탭으로 구성된 50MB 이하 엑셀',
      '구조가 일정한 법령·사규·설명서·보고서',
    ],
  },
  {
    id: 'split-and-retry',
    step: 2,
    title: '크거나 복잡하면 나눠서 다시 처리하세요',
    description:
      '파일이 너무 크거나 관계없는 내용이 많이 섞여 있다면 업무·기간·부서·시트·장별로 나눈 후 다시 이 전처리기로 처리하세요. 나눈 파일에는 원래 문서명과 시트명 또는 장 제목을 남겨야 합니다.',
    examples: [
      '50MB가 넘는 엑셀은 관련 시트 묶음으로 분리',
      '관계없는 탭은 업무·기간·부서별 파일로 분리',
      '매우 긴 PDF는 장이나 절 단위로 분리',
    ],
  },
  {
    id: 'assisted-processing',
    step: 3,
    title: '1·2번으로 어려울 때만 별도 도움을 검토하세요',
    description:
      '1번과 2번 방법으로 처리하기 어렵거나 실패한 경우에만 담당자 또는 회사에서 허용한 Codex·Claude 같은 도구의 도움을 검토하세요. 다른 도구로 추출했더라도 결과 확인과 전처리는 다시 필요합니다.',
    examples: [
      '글자가 흐리거나 기울어진 스캔 PDF',
      '병합 셀과 다단 구성이 복잡한 표',
      '암호·손상·반복 오류로 추출되지 않는 파일',
    ],
  },
];

export const DOCUMENT_HANDLING_SECURITY_NOTICE =
  '상용 AI가 항상 더 정확하거나 모든 파일을 한 번에 처리하는 것은 아닙니다. 사내 문서는 회사 보안정책에서 허용한 환경에서만 사용하고, 처리 결과는 반드시 원문과 비교해 확인하세요.';
