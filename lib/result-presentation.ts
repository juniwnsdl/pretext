import type { ResultStatus } from '@/lib/preprocessing/contracts';

export type ResultPresentationTone = 'success' | 'warning' | 'destructive';

export interface ResultPresentation {
  label: string;
  tone: ResultPresentationTone;
  allowMisoDownload: boolean;
}

const RESULT_PRESENTATIONS: Record<ResultStatus, ResultPresentation> = {
  ready: {
    label: 'MISO 등록 가능',
    tone: 'success',
    allowMisoDownload: true,
  },
  review: {
    label: '원문 확인 필요',
    tone: 'warning',
    allowMisoDownload: true,
  },
  blocked: {
    label: '오류 확인 필요',
    tone: 'destructive',
    allowMisoDownload: false,
  },
};

export function getResultPresentation(status: ResultStatus): ResultPresentation {
  return RESULT_PRESENTATIONS[status];
}
