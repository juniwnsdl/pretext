import React, { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GripHorizontal, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { APP_CHUNK_LIMIT } from '@/lib/preprocessing/contracts';

interface ChunkFlowViewerProps {
  chunks: string[];
  onChunkUpdate?: (newChunks: string[]) => void;
}

/**
 * 드래그 중 스냅 가능한 지점 하나.
 * - side 'prev'    : 이전 청크를 offset에서 분할 → 뒷부분이 현재 청크로 내려감
 * - side 'current' : 현재 청크를 offset에서 분할 → 앞부분이 이전 청크로 올라감
 * - side 'none'    : 현재 경계 그대로 (변경 없음)
 */
interface SnapCandidate {
  side: 'prev' | 'current' | 'none';
  offset: number;
  /** 콘텐츠 컨테이너 기준 Y 좌표 (스크롤과 무관하게 안정적) */
  y: number;
  /** 이동 수량 표시용 라벨 (예: "3줄", "블록 2개") */
  movedLabel: string;
}

interface DragPreview {
  candidate: SnapCandidate;
  newPrev: string;
  newCurrent: string;
}

interface TopBlock {
  offset: number;
  top: number;
  bottom: number;
  kind: 'block' | 'line';
}

// ReactMarkdown 플러그인: 모든 요소에 data-source-pos 속성을 주입하여 원본 위치 추적
const addSourcePosPlugin = () => {
  return (tree: any) => {
    const visit = (node: any) => {
      if (node.position && node.position.start && node.type !== 'root') {
        if (!node.data) node.data = {};
        if (!node.data.hProperties) node.data.hProperties = {};
        node.data.hProperties['data-source-pos'] = node.position.start.offset;
      }
      if (node.children) {
        node.children.forEach(visit);
      }
    };
    visit(tree);
  };
};

/** 분할 지점 앞뒤의 개행을 정리하고 블록 사이를 빈 줄 하나로 잇는다. */
function joinBlocks(left: string, right: string): string {
  const a = left.replace(/\n+$/, '');
  const b = right.replace(/^\n+/, '');
  if (!a) return b;
  if (!b) return a;
  return `${a}\n\n${b}`;
}

/** offset 앞은 남기고 뒤는 이동 대상으로 자른다. 남는 쪽 끝의 개행은 정리한다. */
function splitAtBlock(text: string, offset: number): [string, string] {
  return [text.slice(0, offset).replace(/\n+$/, ''), text.slice(offset)];
}

function computePreview(
  prev: string,
  current: string,
  candidate: SnapCandidate,
): { newPrev: string; newCurrent: string } {
  if (candidate.side === 'prev') {
    const [newPrev, moved] = splitAtBlock(prev, candidate.offset);
    return { newPrev, newCurrent: joinBlocks(moved, current) };
  }
  if (candidate.side === 'current') {
    const [moved, newCurrent] = splitAtBlock(current, candidate.offset);
    return { newPrev: joinBlocks(prev, moved), newCurrent };
  }
  return { newPrev: prev, newCurrent: current };
}

/**
 * 평문 블록 내부의 줄 시작 지점들을 수집한다.
 * 블록 텍스트가 원본과 문자 단위로 일치할 때만 호출되므로,
 * Range API로 얻는 화면 좌표와 원본 오프셋이 정확히 대응한다.
 */
function collectLineUnits(
  blockEl: HTMLElement,
  blockOffset: number,
  contentTop: number,
  blockBottom: number,
): TopBlock[] {
  const units: TopBlock[] = [];
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let accumulated = 0;
  let pendingOffset: number | null = null;

  const pushLineStart = (node: Text, indexInNode: number, offset: number) => {
    const nodeLength = node.nodeValue?.length ?? 0;
    if (indexInNode >= nodeLength) return;
    range.setStart(node, indexInNode);
    range.setEnd(node, Math.min(indexInNode + 1, nodeLength));
    const rect = range.getClientRects()[0];
    if (!rect) return;
    units.push({ offset, top: rect.top - contentTop, bottom: blockBottom, kind: 'line' });
  };

  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    const value = textNode.nodeValue ?? '';
    // 직전 텍스트 노드가 개행으로 끝난 경우: 이 노드의 첫 글자가 줄 시작이다
    if (pendingOffset !== null) {
      pushLineStart(textNode, 0, pendingOffset);
      pendingOffset = null;
    }
    let newlineIndex = value.indexOf('\n');
    while (newlineIndex !== -1) {
      const lineStart = newlineIndex + 1;
      const offset = blockOffset + accumulated + lineStart;
      if (lineStart < value.length) {
        pushLineStart(textNode, lineStart, offset);
      } else {
        pendingOffset = offset;
      }
      newlineIndex = value.indexOf('\n', lineStart);
    }
    accumulated += value.length;
    node = walker.nextNode();
  }
  return units;
}

/**
 * 청크 컨테이너에서 스냅 단위를 수집한다.
 * - 최상위 마크다운 블록(문단·제목·표·리스트 등)은 항상 스냅 단위다.
 * - 렌더링된 텍스트가 원본과 일치하는 평문 블록은 내부 줄 단위로 세분화한다.
 *   (표·서식 있는 블록은 원본 오프셋을 역산할 수 없으므로 통째로 이동)
 */
function collectSnapUnits(
  chunkEl: HTMLElement,
  chunkText: string,
  contentTop: number,
): TopBlock[] {
  const units: TopBlock[] = [];
  for (const child of Array.from(chunkEl.children)) {
    if (!(child instanceof HTMLElement)) continue;
    // 표는 overflow 래퍼 안에 있으므로 자기 자신 또는 하위에서 source-pos를 찾는다
    const posEl = child.matches('[data-source-pos]')
      ? child
      : child.querySelector<HTMLElement>('[data-source-pos]');
    const raw = posEl?.dataset.sourcePos;
    if (posEl === null || raw === undefined) continue;
    const offset = Number.parseInt(raw, 10);
    if (Number.isNaN(offset)) continue;
    const rect = child.getBoundingClientRect();
    const top = rect.top - contentTop;
    const bottom = rect.bottom - contentTop;
    units.push({ offset, top, bottom, kind: 'block' });

    const text = posEl.textContent ?? '';
    const isPlainText = text.includes('\n')
      && chunkText.slice(offset, offset + text.length) === text;
    if (isPlainText) {
      units.push(...collectLineUnits(posEl, offset, contentTop, bottom));
    }
  }
  units.sort((a, b) => a.offset - b.offset);
  return units;
}

export function ChunkFlowViewer({ chunks, onChunkUpdate }: ChunkFlowViewerProps) {
  // draggingIndex = 드래그 중인 경계 바로 아래 청크의 인덱스.
  // 예: draggingIndex = 1 이면 청크 0과 1 사이 경계를 드래그 중.
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const chunkRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragInfoRef = useRef<{ candidates: SnapCandidate[]; boundaryY: number } | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);
  const lastClientYRef = useRef<number | null>(null);

  // 시각적 구분을 위한 파스텔 톤 색상 팔레트
  const chunkColors = [
    'bg-blue-100 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-800',
    'bg-green-100 dark:bg-green-900/30 text-green-900 dark:text-green-100 border-green-200 dark:border-green-800',
    'bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 border-amber-200 dark:border-amber-800',
    'bg-purple-100 dark:bg-purple-900/30 text-purple-900 dark:text-purple-100 border-purple-200 dark:border-purple-800',
  ];
  // 배지에서 청크를 가리키는 점 색상 (chunkColors와 같은 순서)
  const chunkDotColors = [
    'bg-blue-400',
    'bg-green-400',
    'bg-amber-400',
    'bg-purple-400',
  ];

  const startDrag = (index: number, clientY: number) => {
    const contentEl = contentRef.current;
    const prevEl = chunkRefs.current[index - 1];
    const currEl = chunkRefs.current[index];
    if (!contentEl || !prevEl || !currEl) return;

    const contentTop = contentEl.getBoundingClientRect().top;
    const prevBlocks = collectSnapUnits(prevEl, chunks[index - 1], contentTop);
    const currBlocks = collectSnapUnits(currEl, chunks[index], contentTop);
    const boundaryY = currEl.getBoundingClientRect().top - contentTop;

    const movedLabel = (moved: TopBlock[]): string => (
      moved.every((unit) => unit.kind === 'line')
        ? `${moved.length}줄`
        : `블록 ${moved.filter((unit) => unit.kind === 'block').length}개`
    );

    const candidates: SnapCandidate[] = [];
    // 이전 청크의 스냅 지점들: 거기서 자르면 그 지점부터 끝까지 아래로 내려간다
    prevBlocks.forEach((block, i) => {
      candidates.push({
        side: 'prev',
        offset: block.offset,
        y: block.top,
        movedLabel: movedLabel(prevBlocks.slice(i)),
      });
    });
    // 현재 경계 (변경 없음)
    candidates.push({ side: 'none', offset: 0, y: boundaryY, movedLabel: '' });
    // 현재 청크의 스냅 지점들: 거기서 자르면 그 앞부분이 위로 올라간다
    currBlocks.forEach((block, i) => {
      if (i === 0) return; // 첫 지점 = 현재 경계와 동일
      candidates.push({
        side: 'current',
        offset: block.offset,
        y: block.top,
        movedLabel: movedLabel(currBlocks.slice(0, i)),
      });
    });
    // 현재 청크 끝까지: 전부 위로 올라가 두 청크가 병합된다
    const lastBlock = currBlocks[currBlocks.length - 1];
    if (lastBlock) {
      candidates.push({
        side: 'current',
        offset: chunks[index].length,
        y: lastBlock.bottom,
        movedLabel: movedLabel(currBlocks),
      });
    }

    dragInfoRef.current = { candidates, boundaryY };
    lastClientYRef.current = clientY;
    const initial: DragPreview = {
      candidate: { side: 'none', offset: 0, y: boundaryY, movedLabel: '' },
      newPrev: chunks[index - 1],
      newCurrent: chunks[index],
    };
    dragPreviewRef.current = initial;
    setDragPreview(initial);
    setDraggingIndex(index);
  };

  useEffect(() => {
    if (draggingIndex === null) return;

    const updateProposal = (clientY: number) => {
      const info = dragInfoRef.current;
      const contentEl = contentRef.current;
      if (!info || !contentEl) return;

      const yRel = clientY - contentEl.getBoundingClientRect().top;
      let best: SnapCandidate | null = null;
      let bestDist = Infinity;
      for (const candidate of info.candidates) {
        const dist = Math.abs(candidate.y - yRel);
        if (dist < bestDist) {
          bestDist = dist;
          best = candidate;
        }
      }
      if (!best) return;
      if (dragPreviewRef.current?.candidate === best) return;

      const { newPrev, newCurrent } = computePreview(
        chunks[draggingIndex - 1],
        chunks[draggingIndex],
        best,
      );
      const next: DragPreview = { candidate: best, newPrev, newCurrent };
      dragPreviewRef.current = next;
      setDragPreview(next);
    };

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      lastClientYRef.current = e.clientY;
      updateProposal(e.clientY);
    };

    const endDrag = () => {
      setDraggingIndex(null);
      setDragPreview(null);
      dragPreviewRef.current = null;
      dragInfoRef.current = null;
      lastClientYRef.current = null;
    };

    const handleMouseUp = () => {
      const preview = dragPreviewRef.current;
      if (preview && onChunkUpdate && preview.candidate.side !== 'none') {
        const prevIndex = draggingIndex - 1;
        const currentIndex = draggingIndex;
        const { newPrev, newCurrent } = preview;

        if (newPrev !== chunks[prevIndex] || newCurrent !== chunks[currentIndex]) {
          const next = [...chunks];
          next[prevIndex] = newPrev;
          next[currentIndex] = newCurrent;
          // 한쪽이 비면 그 청크를 제거해 병합한다
          const merged = next.filter((chunk, i) => (
            i === prevIndex || i === currentIndex ? chunk.trim() !== '' : true
          ));
          if (merged.length > 0) {
            onChunkUpdate(merged);
            if (merged.length < next.length) {
              toast.success('청크 병합 완료', {
                description: '빈 청크가 제거되어 하나로 합쳐졌습니다. 되돌리기(Ctrl+Z)로 복구할 수 있습니다.',
              });
            }
          }
        }
      }
      endDrag();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endDrag();
    };

    // 뷰어 가장자리에 가까워지면 자동 스크롤해서 화면 밖 블록으로도 경계를 옮길 수 있게 한다
    let rafId = 0;
    const autoScrollStep = () => {
      const viewport = containerRef.current?.querySelector<HTMLElement>(
        '[data-radix-scroll-area-viewport]',
      );
      const clientY = lastClientYRef.current;
      if (viewport && clientY !== null) {
        const rect = viewport.getBoundingClientRect();
        const margin = 48;
        let delta = 0;
        if (clientY < rect.top + margin) {
          delta = -Math.ceil((rect.top + margin - clientY) / 4);
        } else if (clientY > rect.bottom - margin) {
          delta = Math.ceil((clientY - (rect.bottom - margin)) / 4);
        }
        if (delta !== 0) {
          viewport.scrollTop += delta;
          updateProposal(clientY);
        }
      }
      rafId = requestAnimationFrame(autoScrollStep);
    };
    rafId = requestAnimationFrame(autoScrollStep);

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(rafId);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [draggingIndex, chunks, onChunkUpdate]);

  if (!chunks || chunks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center border-2 border-dashed rounded-lg bg-muted/10">
        <p>생성된 청크가 없습니다.</p>
        <p className="text-sm mt-2">전처리를 먼저 진행해주세요.</p>
      </div>
    );
  }

  const renderDragOverlay = () => {
    if (draggingIndex === null || !dragPreview) return null;
    const { candidate, newPrev, newCurrent } = dragPreview;
    const boundaryY = dragInfoRef.current?.boundaryY ?? candidate.y;
    const regionTop = Math.min(candidate.y, boundaryY);
    const regionHeight = Math.abs(candidate.y - boundaryY);
    const isNoChange = candidate.side === 'none';
    const mergesPrev = !isNoChange && newPrev.trim() === '';
    const mergesCurrent = !isNoChange && newCurrent.trim() === '';
    const isMerge = mergesPrev || mergesCurrent;
    const mergedLength = mergesPrev ? newCurrent.length : newPrev.length;
    const prevOverLimit = newPrev.length > APP_CHUNK_LIMIT;
    const currentOverLimit = newCurrent.length > APP_CHUNK_LIMIT;
    const prevDot = chunkDotColors[(draggingIndex - 1) % chunkDotColors.length];
    const currentDot = chunkDotColors[draggingIndex % chunkDotColors.length];

    return (
      <>
        {/* 이동될 영역 하이라이트 */}
        {!isNoChange && regionHeight > 0 && (
          <div
            className="absolute left-0 right-0 z-40 pointer-events-none bg-primary/10 border-y-2 border-dashed border-primary/40"
            style={{ top: regionTop, height: regionHeight }}
          />
        )}
        {/* 스냅된 분할선 */}
        <div
          className={`absolute left-0 right-0 h-0.5 z-50 pointer-events-none ${
            isNoChange ? 'bg-muted-foreground/40' : 'bg-red-500'
          }`}
          style={{ top: candidate.y - 1 }}
        />
        {/* 분할선 배지: 이동 요약 + 결과 글자수 */}
        <div
          className="absolute right-3 z-50 pointer-events-none -translate-y-1/2"
          style={{ top: Math.max(candidate.y, 18) }}
        >
          <div className="flex items-center gap-1.5 rounded-full border bg-popover px-3 py-1 text-xs shadow-md whitespace-nowrap">
            {isNoChange ? (
              <span className="text-muted-foreground">변경 없음</span>
            ) : isMerge ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  두 청크가 하나로 병합 · {mergedLength.toLocaleString()}자
                </span>
              </>
            ) : (
              <>
                {candidate.side === 'current' ? (
                  <ArrowUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-muted-foreground">
                  {candidate.movedLabel} 이동
                </span>
                <span className="text-muted-foreground/50">·</span>
                <span className={`inline-block h-2 w-2 rounded-full ${prevDot}`} />
                <span className={prevOverLimit ? 'font-semibold text-destructive' : 'font-medium'}>
                  {newPrev.length.toLocaleString()}자
                </span>
                <span className="text-muted-foreground/50">/</span>
                <span className={`inline-block h-2 w-2 rounded-full ${currentDot}`} />
                <span className={currentOverLimit ? 'font-semibold text-destructive' : 'font-medium'}>
                  {newCurrent.length.toLocaleString()}자
                </span>
                {(prevOverLimit || currentOverLimit) && (
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                )}
              </>
            )}
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="relative h-full w-full">
      <ScrollArea className="h-full w-full" ref={containerRef}>
        <div ref={contentRef} className="relative p-4 flex flex-col leading-relaxed text-sm pb-20">
          {chunks.map((chunk, index) => {
            const colorClass = chunkColors[index % chunkColors.length];

            return (
              <div
                key={index}
                ref={el => { chunkRefs.current[index] = el }}
                data-chunk-index={index}
                className={`relative group px-4 pt-8 pb-4 border-b last:border-0 ${colorClass} transition-all ${
                  draggingIndex === null ? 'hover:brightness-95' : ''
                }`}
              >
                {/* 청크 번호 항상 표시 (왼쪽 상단) */}
                <div className="absolute top-2 left-2 z-10 flex items-center gap-2 pointer-events-none">
                  <Badge variant="secondary" className="text-xs font-semibold px-2 py-0.5 bg-background/80 backdrop-blur-sm shadow-sm">
                    Chunk #{index + 1}
                  </Badge>
                  <Badge
                    variant={chunk.length > APP_CHUNK_LIMIT ? 'destructive' : 'outline'}
                    className="text-xs font-semibold px-2 py-0.5 backdrop-blur-sm shadow-sm"
                  >
                    {chunk.length.toLocaleString()}자
                  </Badge>
                </div>

                <ReactMarkdown
                  remarkPlugins={[remarkGfm, addSourcePosPlugin]}
                  components={{
                    h1: ({...props}: any) => <h1 className="text-2xl font-bold mt-4 mb-2 border-b pb-2 first:mt-0" {...props} />,
                    h2: ({...props}: any) => <h2 className="text-xl font-semibold mt-4 mb-2 border-b pb-2 first:mt-0" {...props} />,
                    h3: ({...props}: any) => <h3 className="text-lg font-semibold mt-3 mb-2" {...props} />,
                    h4: ({...props}: any) => <h4 className="text-base font-semibold mt-2 mb-1" {...props} />,
                    p: ({...props}: any) => <p className="leading-7 whitespace-pre-line [&:not(:first-child)]:mt-2" {...props} />,
                    ul: ({...props}: any) => <ul className="my-2 ml-6 list-disc [&>li]:mt-1" {...props} />,
                    ol: ({...props}: any) => <ol className="my-2 ml-6 list-decimal [&>li]:mt-1" {...props} />,
                    li: ({...props}: any) => <li className="" {...props} />,
                    blockquote: ({...props}: any) => <blockquote className="mt-2 border-l-2 pl-4 italic text-muted-foreground" {...props} />,
                    img: ({...props}: any) => <img className="rounded-md border my-2 max-w-full" {...props} alt={props.alt || ''} />,
                    hr: ({...props}: any) => <hr className="my-4 border-muted" {...props} />,
                    table: ({...props}: any) => <div className="my-4 w-full overflow-y-auto"><table className="w-full border-collapse text-sm" {...props} /></div>,
                    tr: ({...props}: any) => <tr className="m-0 border-t p-0 even:bg-muted/50" {...props} />,
                    th: ({...props}: any) => <th className="border px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right bg-muted/50" {...props} />,
                    td: ({...props}: any) => <td className="border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right" {...props} />,
                    code({inline, className, children, ...props}: any) {
                      return !inline ? (
                        <pre className="mb-2 mt-2 overflow-x-auto rounded-lg border bg-muted/50 px-4 py-3 font-mono text-xs" {...props}>
                          <code className={className}>
                            {children}
                          </code>
                        </pre>
                      ) : (
                        <code className={`relative rounded bg-muted/50 px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold ${className || ''}`} {...props}>
                          {children}
                        </code>
                      )
                    }
                  }}
                >
                  {chunk}
                </ReactMarkdown>

                {/* 경계 이동 핸들 - 청크 상단에 표시 (index > 0) */}
                {/* 청크 (index-1)과 index 사이의 경계를 담당한다 */}
                {onChunkUpdate && index > 0 && draggingIndex === null && (
                  <div
                    className="absolute top-0 left-0 right-0 h-4 -translate-y-1/2 cursor-ns-resize flex items-center justify-center z-30 group/handle"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      startDrag(index, e.clientY);
                    }}
                  >
                    <div className="w-full h-[2px] bg-border group-hover/handle:bg-primary transition-colors absolute top-1/2 left-0 right-0" />

                    <div className="bg-background border rounded-full p-1 shadow-sm opacity-0 group-hover/handle:opacity-100 transition-opacity">
                      <GripHorizontal className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {renderDragOverlay()}
        </div>
      </ScrollArea>

      {/* 드래그 중 하단 안내줄 */}
      {draggingIndex !== null && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-1.5 rounded-full border bg-popover/95 px-3 py-1 text-xs text-muted-foreground shadow-md whitespace-nowrap">
            <span>줄·문단·표 단위로 스냅됩니다</span>
            <span className="text-muted-foreground/50">·</span>
            <span className="font-mono text-[10px] border border-muted-foreground/30 rounded px-1">ESC</span>
            <span>취소</span>
          </div>
        </div>
      )}
    </div>
  );
}
