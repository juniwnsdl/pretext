import { Badge } from '@/components/ui/badge';
import type { PreprocessResult } from '@/lib/preprocessing/contracts';
import { getResultPresentation } from '@/lib/result-presentation';

interface PreprocessResultSummaryProps {
  result: PreprocessResult;
}

const toneClasses = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100',
  warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100',
  destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
} as const;

export function PreprocessResultSummary({ result }: PreprocessResultSummaryProps) {
  const presentation = getResultPresentation(result.resultStatus);
  const stats = result.stats;

  return (
    <section
      aria-label="전처리 품질 요약"
      className={`space-y-3 rounded-lg border p-4 ${toneClasses[presentation.tone]}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={presentation.tone === 'destructive' ? 'destructive' : 'outline'}>
          {presentation.label}
        </Badge>
        <span className="text-sm font-medium">예상 청크 {stats.chunkCount.toLocaleString()}개</span>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <div><dt className="text-muted-foreground">가장 긴 청크</dt><dd className="font-semibold">{stats.longestChunkLength.toLocaleString()}자</dd></div>
        <div><dt className="text-muted-foreground">3,800자 초과</dt><dd className="font-semibold">{stats.safeLimitExceededCount.toLocaleString()}개</dd></div>
        <div><dt className="text-muted-foreground">4,000자 초과</dt><dd className="font-semibold">{stats.misoLimitExceededCount.toLocaleString()}개</dd></div>
        <div><dt className="text-muted-foreground">구분자 충돌</dt><dd className="font-semibold">{stats.sourceSeparatorCollisionCount.toLocaleString()}개</dd></div>
        <div><dt className="text-muted-foreground">상태</dt><dd className="font-semibold">{presentation.label}</dd></div>
      </dl>

      {result.issues.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {result.issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>{issue.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
