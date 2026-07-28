import React, { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GripHorizontal } from 'lucide-react';
import {
  applyChunkBoundary,
  getTopLevelBoundaryOffsets,
  selectNearestRenderedBoundary,
} from '@/lib/chunk-boundary';

interface ChunkFlowViewerProps {
  chunks: string[];
  onChunkUpdate?: (newChunks: string[]) => void;
}

interface HoverSplitInfo {
  chunkIndex: number;
  offset: number;
  clientY: number;
  contextBefore: string;
  contextAfter: string;
}

// 유효한 Markdown 블록 경계를 렌더링된 요소와 연결한다.
const addBoundaryPositionsPlugin = () => {
  return (tree: any) => {
    const boundaryOffsets = new Set(
      getTopLevelBoundaryOffsets(tree.children || []),
    );

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

    for (const node of tree.children || []) {
      const offset = node.position?.start?.offset;
      if (typeof offset !== 'number' || !boundaryOffsets.has(offset)) continue;

      if (!node.data) node.data = {};
      if (!node.data.hProperties) node.data.hProperties = {};
      node.data.hProperties['data-chunk-boundary-offset'] = offset;
    }

    visit(tree);
  };
};

export function ChunkFlowViewer({ chunks, onChunkUpdate }: ChunkFlowViewerProps) {
  // draggingIndex represents the index of the chunk *after* the boundary being dragged.
  // e.g. draggingIndex = 1 means we are dragging the boundary between chunk 0 and chunk 1.
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [hoverSplitInfo, setHoverSplitInfo] = useState<HoverSplitInfo | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const chunkRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hoverSplitInfoRef = useRef<HoverSplitInfo | null>(null);

  // 시각적 구분을 위한 파스텔 톤 색상 팔레트
  const chunkColors = [
    'bg-blue-100 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-800',
    'bg-green-100 dark:bg-green-900/30 text-green-900 dark:text-green-100 border-green-200 dark:border-green-800',
    'bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 border-amber-200 dark:border-amber-800',
    'bg-purple-100 dark:bg-purple-900/30 text-purple-900 dark:text-purple-100 border-purple-200 dark:border-purple-800',
  ];

  useEffect(() => {
    if (draggingIndex === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();

      const chunkDiv = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-chunk-index]') as HTMLElement | null;

      if (!chunkDiv) return;

      const targetChunkIndex = parseInt(chunkDiv.dataset.chunkIndex || '-1');
      if (targetChunkIndex !== draggingIndex - 1 && targetChunkIndex !== draggingIndex) return;

      const targetChunkText = chunks[targetChunkIndex];
      const renderedBoundaries = Array.from(
        chunkDiv.querySelectorAll<HTMLElement>('[data-chunk-boundary-offset]'),
      )
        .filter((element) => element.closest('[data-chunk-index]') === chunkDiv)
        .map((element) => ({
          chunkIndex: targetChunkIndex,
          offset: Number(element.dataset.chunkBoundaryOffset),
          clientY: element.getBoundingClientRect().top,
        }))
        .filter(
          (boundary) =>
            Number.isFinite(boundary.offset) &&
            boundary.offset > 0 &&
            boundary.offset < targetChunkText.length,
        );

      const selectedBoundary = selectNearestRenderedBoundary(
        renderedBoundaries,
        e.clientY,
      );

      if (!selectedBoundary) {
        hoverSplitInfoRef.current = null;
        setHoverSplitInfo(null);
        return;
      }

      const CONTEXT_LEN = 20;
      const nextHoverSplitInfo: HoverSplitInfo = {
        ...selectedBoundary,
        contextBefore: targetChunkText.substring(
          Math.max(0, selectedBoundary.offset - CONTEXT_LEN),
          selectedBoundary.offset,
        ),
        contextAfter: targetChunkText.substring(
          selectedBoundary.offset,
          Math.min(targetChunkText.length, selectedBoundary.offset + CONTEXT_LEN),
        ),
      };

      hoverSplitInfoRef.current = nextHoverSplitInfo;
      setHoverSplitInfo(nextHoverSplitInfo);
    };

    const handleMouseUp = () => {
      if (draggingIndex !== null && hoverSplitInfoRef.current && onChunkUpdate) {
        const newChunks = applyChunkBoundary(
          chunks,
          draggingIndex,
          hoverSplitInfoRef.current,
        );

        if (newChunks) onChunkUpdate(newChunks);
      }

      hoverSplitInfoRef.current = null;
      setDraggingIndex(null);
      setHoverSplitInfo(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hoverSplitInfoRef.current = null;
        setDraggingIndex(null);
        setHoverSplitInfo(null);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
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

  return (
    <ScrollArea className="h-full w-full relative" ref={containerRef}>
      <div className="p-4 flex flex-col leading-relaxed text-sm pb-20">
        {chunks.map((chunk, index) => {
          const colorClass = chunkColors[index % chunkColors.length];
          // We are dragging the boundary BEFORE this chunk if draggingIndex === index
          // We are dragging the boundary AFTER this chunk if draggingIndex === index + 1
          const isDraggingBoundaryBefore = draggingIndex === index;
          
          return (
            <div 
              key={index}
              ref={el => { chunkRefs.current[index] = el }}
              data-chunk-index={index}
              className={`relative group px-4 pt-8 pb-4 border-b last:border-0 ${colorClass} transition-all ${
                // If dragging this chunk's TOP boundary, highlight
                isDraggingBoundaryBefore ? 'ring-t-2 ring-primary z-20' : 'hover:brightness-95'
              }`}
            >
              {/* 청크 번호 항상 표시 (왼쪽 상단) */}
              <div className="absolute top-2 left-2 z-10 pointer-events-none">
                <Badge variant="secondary" className="text-xs font-semibold px-2 py-0.5 bg-background/80 backdrop-blur-sm shadow-sm">
                  Chunk #{index + 1}
                </Badge>
              </div>
              
              <ReactMarkdown 
                remarkPlugins={[remarkGfm, addBoundaryPositionsPlugin]}
                components={{
                  h1: ({...props}: any) => <h1 className="text-2xl font-bold mt-4 mb-2 border-b pb-2 first:mt-0" {...props} />,
                  h2: ({...props}: any) => <h2 className="text-xl font-semibold mt-4 mb-2 border-b pb-2 first:mt-0" {...props} />,
                  h3: ({...props}: any) => <h3 className="text-lg font-semibold mt-3 mb-2" {...props} />,
                  h4: ({...props}: any) => <h4 className="text-base font-semibold mt-2 mb-1" {...props} />,
                  p: ({...props}: any) => <p className="leading-7 [&:not(:first-child)]:mt-2" {...props} />,
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

              {/* Resize Handle - Shown at the TOP of chunk (for index > 0) */}
              {/* This handle controls the boundary between (index-1) and index */}
              {onChunkUpdate && index > 0 && (
                <div 
                  className="absolute top-0 left-0 right-0 h-4 -translate-y-1/2 cursor-ns-resize flex items-center justify-center z-30 group/handle"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    hoverSplitInfoRef.current = null;
                    setHoverSplitInfo(null);
                    setDraggingIndex(index);
                  }}
                >
                   {/* Handle visual: Always visible thin line, grip on hover */}
                   <div className="w-full h-[2px] bg-border group-hover/handle:bg-primary transition-colors absolute top-1/2 left-0 right-0" />
                   
                   <div className="bg-background border rounded-full p-1 shadow-sm opacity-0 group-hover/handle:opacity-100 transition-opacity">
                      <GripHorizontal className="h-4 w-4 text-primary" />
                   </div>
                </div>
              )}
              
              {/* Split Preview Line */}
              {draggingIndex !== null && hoverSplitInfo?.chunkIndex === index && (
                 <div 
                   className="absolute left-0 right-0 h-0.5 bg-red-500 z-50 pointer-events-none"
                   style={{ 
                     top: hoverSplitInfo.clientY - (chunkRefs.current[index]?.getBoundingClientRect().top || 0)
                   }}
                 />
              )}
            </div>
          );
        })}

        {/* Floating Context Tooltip */}
        {draggingIndex !== null && hoverSplitInfo && (
          <div 
            className="fixed left-0 right-0 bottom-24 mx-auto z-[100] bg-popover text-popover-foreground px-6 py-4 rounded-xl shadow-2xl border text-base pointer-events-none flex flex-col justify-center animate-in fade-in zoom-in-95 duration-100 w-[600px] h-[110px]"
          >
            <div className="flex items-center justify-between w-full mb-2 border-b pb-2">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">청크 분할 미리보기</span>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                <span className="font-mono text-[10px] border border-muted-foreground/30 rounded px-1">ESC</span>
                <span>취소</span>
              </div>
            </div>
            <div className="flex items-center justify-center gap-4 w-full">
              <div className="flex-1 text-right overflow-hidden">
                <span className="opacity-70 block truncate">...{hoverSplitInfo.contextBefore.replace(/[\r\n]+/g, ' ')}</span>
              </div>
              <span className="text-red-500 font-extrabold text-xl mx-1 shrink-0">|</span>
              <div className="flex-1 text-left overflow-hidden">
                <span className="font-medium block truncate">{hoverSplitInfo.contextAfter.replace(/[\r\n]+/g, ' ')}...</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
