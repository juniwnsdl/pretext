'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  MolegLawSearchItem,
  MolegLawSearchResult,
} from '@/lib/moleg-law-types';

interface LawSearchPanelProps {
  onLoadLaw: (law: MolegLawSearchItem) => Promise<void>;
}
interface LawSearchApiResponse {
  success?: boolean;
  data?: MolegLawSearchResult;
  error?: string | { message?: unknown };
}

function responseError(payload: LawSearchApiResponse): string {
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
  if (
    typeof payload.error === 'object'
    && payload.error !== null
    && typeof payload.error.message === 'string'
    && payload.error.message.trim()
  ) {
    return payload.error.message;
  }
  return '법령을 검색하지 못했습니다.';
}

function formatDate(value: string): string {
  if (!/^\d{8}$/u.test(value)) return value || '-';
  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

export function LawSearchPanel({ onLoadLaw }: LawSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [result, setResult] = useState<MolegLawSearchResult | null>(null);
  const [selected, setSelected] = useState<MolegLawSearchItem | null>(null);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => searchAbortRef.current?.abort(), []);

  const searchLaws = async (term: string, page: number) => {
    const normalized = term.trim();
    if (!normalized) {
      setError('검색할 법령명을 입력해 주세요.');
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({ query: normalized, page: String(page) });
      const response = await fetch(`/api/laws/search?${params.toString()}`, {
        signal: controller.signal,
      });
      const payload = await response.json() as LawSearchApiResponse;
      if (!response.ok || payload.success !== true || !payload.data) {
        throw new Error(responseError(payload));
      }
      if (controller.signal.aborted) return;
      setSearchedQuery(normalized);
      setResult(payload.data);
      setSelected(null);
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : '법령을 검색하지 못했습니다.');
    } finally {
      if (searchAbortRef.current === controller) searchAbortRef.current = null;
      if (!controller.signal.aborted) setSearching(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void searchLaws(query, 1);
  };

  const totalPages = result
    ? Math.max(1, Math.ceil(result.totalCount / Math.max(1, result.pageSize)))
    : 1;

  const handleImport = async () => {
    if (!selected) return;
    setImporting(true);
    try {
      await onLoadLaw(selected);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="법령명을 입력하세요 (예: 산업안전보건법)"
          aria-label="법령명"
          maxLength={100}
          disabled={searching || importing}
        />
        <Button type="submit" disabled={searching || importing || !query.trim()} className="sm:w-28">
          {searching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          검색
        </Button>
      </form>

      <p className="text-xs leading-5 text-muted-foreground">
        국가법령정보센터의 현재 시행 중인 법령을 법령명으로 검색합니다.
      </p>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p>
              <strong>&lsquo;{searchedQuery}&rsquo;</strong> 검색 결과{' '}
              <strong>{result.totalCount.toLocaleString()}건</strong>
            </p>
            {result.totalCount > 0 && (
              <span className="text-muted-foreground">{result.page} / {totalPages} 페이지</span>
            )}
          </div>

          {result.items.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              일치하는 현행 법령이 없습니다. 법령명을 다시 확인해 주세요.
            </div>
          ) : (
            <div role="radiogroup" aria-label="법령 검색 결과" className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
              {result.items.map((law) => {
                const isSelected = selected?.mst === law.mst && selected.effectiveDate === law.effectiveDate;
                return (
                  <button
                    key={`${law.mst}-${law.effectiveDate}`}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelected(law)}
                    disabled={importing}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'hover:border-muted-foreground/30 hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${isSelected ? 'border-primary' : 'border-muted-foreground/50'}`}>
                        {isSelected && <span className="h-2 w-2 rounded-full bg-primary" />}
                      </span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{law.name}</span>
                          {law.lawType && <Badge variant="outline">{law.lawType}</Badge>}
                          {law.revisionType && <Badge variant="secondary">{law.revisionType}</Badge>}
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">
                          {law.ministry || '소관부처 미표시'} · 시행 {formatDate(law.effectiveDate)}
                          {law.promulgationNumber ? ` · 공포번호 ${law.promulgationNumber}` : ''}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {result.totalCount > result.pageSize && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={searching || importing || result.page <= 1}
                onClick={() => void searchLaws(searchedQuery, result.page - 1)}
              >
                <ChevronLeft className="mr-1 h-4 w-4" /> 이전
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={searching || importing || result.page >= totalPages}
                onClick={() => void searchLaws(searchedQuery, result.page + 1)}
              >
                다음 <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          )}

          {result.items.length > 0 && (
            <Button
              type="button"
              size="lg"
              className="h-12 w-full text-base font-semibold"
              disabled={!selected || importing || searching}
              onClick={() => void handleImport()}
            >
              {importing ? (
                <><Loader2 className="mr-2 h-5 w-5 animate-spin" />법령 본문 가져오는 중...</>
              ) : (
                <><BookOpen className="mr-2 h-5 w-5" />선택한 법령 가져오기</>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
