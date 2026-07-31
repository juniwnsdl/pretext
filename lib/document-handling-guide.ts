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

export const TABLE_HANDLING_GUIDANCE = [
  {
    title: '병합·다단 머리행',
    description:
      '엑셀의 병합·다단 머리행은 열마다 상위 > 하위로 연결하고 중복 제목을 제거합니다. 자동 감지가 실제 표와 다르면 엑셀 머리행 설정에서 직접 정하고, 복잡한 구조는 원본과 비교하세요.',
  },
  {
    title: '수식이 있는 엑셀',
    description:
      '기본값은 파일에 저장된 계산값입니다. 엑셀 머리행 설정에서 표시값 + 수식을 선택할 수 있지만, 이 앱은 수식을 다시 계산하지 않습니다. 최신 값은 Excel에서 계산·저장한 뒤 확인하세요.',
  },
  {
    title: '엑셀 메모·댓글',
    description:
      '존재와 위치만 감지하며 메모·댓글의 본문, 작성자, 답글, 멘션, 해결 상태는 결과에 포함하지 않습니다. 중요한 정보는 원본 Excel에서 확인하세요.',
  },
  {
    title: 'Word·HWP 변환본·PDF의 표',
    description:
      'Word(DOCX), HWP 변환본, PDF 표는 추출기가 표 구조를 보존한 경우에만 같은 방식으로 처리합니다. 병합·다단 머리행·회전 글자·도형·페이지 연결이 복잡한 PDF 표는 정확한 복원을 보장하지 않으므로 원본과 비교하세요.',
  },
  {
    title: '문서 제목 계층',
    description:
      '확인된 매뉴얼의 직접 숫자 부모는 최대 4단계까지 문맥에 잇습니다. 일반 문서는 엄격한 로마 상위 제목과 현재 번호 제목만 2단계로 잇고, 추론이 불확실하면 본문을 보존해 검토 대상으로 남깁니다. 법령은 기존 조문 중심 기준을 적용합니다.',
  },
] as const;
