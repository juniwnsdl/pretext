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

export type StructuralDifficulty = {
  id: string;
  title: string;
  /** 접힌 상태에서 보이는 한 줄 요약: 왜 어려운지의 핵심 */
  summary: string;
  /** 왜 어려운가·어떻게 처리해야 하는가를 설명하는 인포그래픽 경로 (public 기준) */
  image: string;
  /** 이 전처리기가 실제로 구현한 범위와 남는 한계 */
  coverage: string;
};

export const STRUCTURAL_DIFFICULTY_GUIDANCE: readonly StructuralDifficulty[] = [
  {
    id: 'tables',
    title: '표와 병합 셀',
    summary: '표는 가로세로로 읽는데 텍스트는 한 줄씩이라, 펴는 순간 행과 열의 관계가 끊깁니다.',
    image: '/guide/tables.png',
    coverage:
      '엑셀은 머리행 범위를 자동 감지해 상위 > 하위로 연결하고 중복 제목을 제거하며, 감지가 실제 표와 다르면 엑셀 머리행 설정에서 직접 지정할 수 있습니다. 워드·PDF 표는 추출기가 표 구조를 보존한 경우에만 같은 방식으로 처리하고, 병합·회전 글자·페이지를 넘어가는 표는 복원을 보장하지 않습니다.',
  },
  {
    id: 'page-decoration',
    title: '머리말·꼬리말·쪽번호',
    summary: '페이지마다 반복되는 문구가 문장 한가운데를 끊고 들어옵니다.',
    image: '/guide/page-decoration.png',
    coverage:
      '쪽번호 줄 근처에서 반복되는 짧은 머리말·꼬리말은 첫 번째만 남기고 정리하며, 쪽번호만 있는 줄도 함께 지우고 몇 줄을 정리했는지 경고로 알려줍니다. 마침표로 끝나는 문장이나 목록·표 줄은 정리 대상에서 제외합니다.',
  },
  {
    id: 'figures',
    title: '그림·차트·도형 안의 글자',
    summary: '조직도·흐름도·스크린샷 속 글자는 그림이라 텍스트로 나오지 않습니다.',
    image: '/guide/figures.png',
    coverage:
      '이미지 파일(JPG·PNG 등)을 직접 올리면 MISO로 보내 글자를 추출합니다. 다만 워드·PDF 문서 안에 그림으로 들어간 조직도·차트·스크린샷은 추출되지 않으므로, 결과에서 빠졌다면 직접 보완하세요.',
  },
  {
    id: 'reading-order',
    title: '읽는 순서 (다단 편집·각주)',
    summary: '사람이 보는 순서와 텍스트로 뽑히는 순서가 다를 수 있습니다.',
    image: '/guide/reading-order.png',
    coverage:
      '읽는 순서는 추출기가 준 결과를 그대로 사용하며, 단 구성을 다시 정렬하거나 각주를 본문에서 분리하지 않습니다. 텍스트 추출 확인 단계에서 반드시 원문과 비교하세요.',
  },
  {
    id: 'formula',
    title: '수식·기호',
    summary: '엑셀 계산식과 논문 수식은 서로 다른 이유로 텍스트에서 무너집니다.',
    image: '/guide/formula.png',
    coverage:
      '엑셀은 기본이 파일에 저장된 계산값이고 엑셀 머리행 설정에서 표시값 + 수식을 선택할 수 있으며, 수식을 다시 계산하지는 않습니다. 워드·PDF의 수식 개체는 복원하지 않으므로 결과에서 빠졌거나 깨졌는지 확인하고 필요하면 직접 고치세요.',
  },
  {
    id: 'comments',
    title: '메모·댓글·변경 이력',
    summary: '확정된 본문인지 진행 중인 논의인지 구분되지 않은 채 섞여 들어옵니다.',
    image: '/guide/comments.png',
    coverage:
      '엑셀 메모·댓글은 존재와 위치만 표시하고 본문, 작성자, 답글, 멘션, 해결 상태는 결과에 포함하지 않습니다. 워드의 댓글·변경 이력은 따로 걸러내지 않으므로 최종본으로 확정한 파일을 올려주세요.',
  },
];
