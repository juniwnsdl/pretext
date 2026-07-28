import React, { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GripHorizontal } from 'lucide-react';

interface ChunkFlowViewerProps {
  chunks: string[];
  onChunkUpdate?: (newChunks: string[]) => void;
}

interface HoverSplitInfo {
  chunkIndex: number;
  offset: number; // Offset relative to the chunk start
  clientY: number;
  clientX: number;
  contextBefore: string;
  contextAfter: string;
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

export function ChunkFlowViewer({ chunks, onChunkUpdate }: ChunkFlowViewerProps) {
  // draggingIndex represents the index of the chunk *after* the boundary being dragged.
  // e.g. draggingIndex = 1 means we are dragging the boundary between chunk 0 and chunk 1.
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [hoverSplitInfo, setHoverSplitInfo] = useState<HoverSplitInfo | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const chunkRefs = useRef<(HTMLDivElement | null)[]>([]);

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
      
      // Find the element under cursor
      let targetRange: Range | null = null;
      let targetNode: Node | null = null;
      let targetOffset = 0;

      if (document.caretRangeFromPoint) {
        targetRange = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (targetRange) {
          targetNode = targetRange.startContainer;
          targetOffset = targetRange.startOffset;
        }
      } else if ((document as any).caretPositionFromPoint) {
        const pos = (document as any).caretPositionFromPoint(e.clientX, e.clientY);
        if (pos) {
          targetNode = pos.offsetNode;
          targetOffset = pos.offset;
        }
      }

      if (!targetNode) return;

      // Find which chunk this node belongs to
      const chunkDiv = (targetNode.nodeType === Node.ELEMENT_NODE 
        ? targetNode as Element 
        : targetNode.parentElement)?.closest('[data-chunk-index]') as HTMLElement;

      if (!chunkDiv) return;

      const targetChunkIndex = parseInt(chunkDiv.dataset.chunkIndex || '-1');
      
      // Valid targets are (draggingIndex - 1) and draggingIndex
      // e.g. dragging between 0 and 1 (draggingIndex=1). Valid: 0 and 1.
      if (targetChunkIndex !== draggingIndex - 1 && targetChunkIndex !== draggingIndex) return;

      // Find source pos
      const sourcePosElement = (targetNode.nodeType === Node.ELEMENT_NODE
        ? targetNode as Element
        : targetNode.parentElement)?.closest('[data-source-pos]') as HTMLElement;

      let baseOffset = 0;
      if (sourcePosElement && sourcePosElement.dataset.sourcePos) {
        baseOffset = parseInt(sourcePosElement.dataset.sourcePos, 10);
      }

      let currentChunkOffset = baseOffset + targetOffset;
      const targetChunkText = chunks[targetChunkIndex];

      // Snap to nearest newline
      // We want to find the nearest split point that corresponds to a line boundary.
      // Valid split points are: 0 (start), or index+1 where targetChunkText[index] === '\n'.
      let closestSplitPoint = 0;
      let minDistance = Math.abs(0 - currentChunkOffset);

      for (let i = 0; i < targetChunkText.length; i++) {
        if (targetChunkText[i] === '\n') {
          const splitPoint = i + 1;
          const dist = Math.abs(splitPoint - currentChunkOffset);
          if (dist < minDistance) {
            minDistance = dist;
            closestSplitPoint = splitPoint;
          }
        }
      }
      
      // Also check end of text
      const endDist = Math.abs(targetChunkText.length - currentChunkOffset);
      if (endDist < minDistance) {
        closestSplitPoint = targetChunkText.length;
      }

      currentChunkOffset = closestSplitPoint;
      
      // Extract context for tooltip
      const CONTEXT_LEN = 20;
      const contextBefore = targetChunkText.substring(Math.max(0, currentChunkOffset - CONTEXT_LEN), currentChunkOffset);
      const contextAfter = targetChunkText.substring(currentChunkOffset, Math.min(targetChunkText.length, currentChunkOffset + CONTEXT_LEN));

      // Try to snap line to text line
      // Since we snapped the offset to a newline, we should try to find the visual position of that line.
      // Ideally we'd find the element corresponding to that newline, but markdown rendering makes it hard.
      // For now, we'll stick with the mouse Y or try to refine it if possible, but the crucial part is the logical offset.
      
      let lineY = e.clientY;
      if (targetRange) {
         // This gives the bounding rect of the range (which is collapsed)
         // Sometimes getBoundingClientRect() returns 0 size.
         const rects = targetRange.getClientRects();
         if (rects.length > 0) {
           lineY = rects[0].bottom;
         } else {
            const rect = targetRange.getBoundingClientRect();
            if (rect.height > 0) {
               lineY = rect.bottom;
            }
         }
      }

      setHoverSplitInfo({
        chunkIndex: targetChunkIndex,
        offset: currentChunkOffset,
        clientY: lineY,
        clientX: e.clientX,
        contextBefore,
        contextAfter
      });
    };

    const handleMouseUp = () => {
      if (draggingIndex !== null && hoverSplitInfo && onChunkUpdate) {
        const { chunkIndex, offset } = hoverSplitInfo;
        const prevChunkIndex = draggingIndex - 1;
        const currentChunkIndex = draggingIndex;

        const prevChunk = chunks[prevChunkIndex];
        const currentChunk = chunks[currentChunkIndex];

        let newPrevChunk = prevChunk;
        let newCurrentChunk = currentChunk;

        if (chunkIndex === prevChunkIndex) {
          // Dragged UP into the previous chunk (prevChunkIndex)
          // Split prevChunk at offset.
          // Part 1: stays in prevChunk
          // Part 2: goes to currentChunk
          const splitPoint = offset;
          if (splitPoint >= 0 && splitPoint <= prevChunk.length) {
             newPrevChunk = prevChunk.substring(0, splitPoint);
             const movedPart = prevChunk.substring(splitPoint);
             
             // Check if we need a newline joiner to prevent merging lines
             let joiner = '';
             if (movedPart.length > 0 && currentChunk.length > 0) {
               const lastChar = movedPart[movedPart.length - 1];
               const firstChar = currentChunk[0];
               if (lastChar !== '\n' && firstChar !== '\n') {
                 joiner = '\n';
               }
             }
             
             newCurrentChunk = movedPart + joiner + currentChunk;
          }
        } else if (chunkIndex === currentChunkIndex) {
          // Dragged DOWN into the current chunk (currentChunkIndex)
          // Split currentChunk at offset.
          // Part 1: goes to prevChunk
          // Part 2: stays in currentChunk
          const splitPoint = offset;
          if (splitPoint >= 0 && splitPoint <= currentChunk.length) {
            const movedPart = currentChunk.substring(0, splitPoint);
            
            // Check if we need a newline joiner
             let joiner = '';
             if (prevChunk.length > 0 && movedPart.length > 0) {
               const lastChar = prevChunk[prevChunk.length - 1];
               const firstChar = movedPart[0];
               if (lastChar !== '\n' && firstChar !== '\n') {
                 joiner = '\n';
               }
             }

            newPrevChunk = prevChunk + joiner + movedPart;
            newCurrentChunk = currentChunk.substring(splitPoint);
          }
        }

        if (newPrevChunk !== prevChunk || newCurrentChunk !== currentChunk) {
          const newChunks = [...chunks];
          newChunks[prevChunkIndex] = newPrevChunk;
          newChunks[currentChunkIndex] = newCurrentChunk;
          onChunkUpdate(newChunks);
        }
      }

      setDraggingIndex(null);
      setHoverSplitInfo(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
  }, [draggingIndex, chunks, onChunkUpdate, hoverSplitInfo]);

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
                remarkPlugins={[remarkGfm, addSourcePosPlugin]}
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
