'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Search, 
  X,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { APP_CHUNK_LIMIT } from '@/lib/preprocessing/contracts';
import { filterIndexedChunks, removeChunkAt } from '@/lib/chunk-viewer-model';

interface ChunkViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  chunks: string[];
  onChunksChange?: (chunks: string[]) => void;
}

export function ChunkViewerModal({
  isOpen,
  onClose,
  chunks,
  onChunksChange,
}: ChunkViewerModalProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  // 모달이 열릴 때 상태 초기화
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
      setSearchQuery('');
      setIsDeleteDialogOpen(false);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, chunks.length - 1)));
  }, [chunks.length]);

  // 검색 필터링
  const filteredChunks = useMemo(() => {
    return filterIndexedChunks(chunks, searchQuery);
  }, [chunks, searchQuery]);

  const selectedChunk = useMemo(() => {
    return chunks[selectedIndex];
  }, [chunks, selectedIndex]);

  const formatCharCount = (count: number) => `${count.toLocaleString()}자`;

  const handlePrevious = () => {
    if (selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
  };

  const handleNext = () => {
    if (selectedIndex < chunks.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
  };

  const handleDelete = () => {
    if (!onChunksChange) return;
    const next = removeChunkAt(chunks, selectedIndex);
    setSelectedIndex(next.selectedIndex);
    setSearchQuery('');
    setIsDeleteDialogOpen(false);
    onChunksChange(next.chunks);
  };

  if (!isOpen) return null;

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="!max-w-none w-[80vw] h-[80vh] flex flex-col p-0 gap-0"
        showCloseButton={false}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-xl font-bold">청크 보기</DialogTitle>
            <Badge variant="secondary" className="bg-primary/10 text-primary font-semibold px-3">
              총 {chunks.length}개
            </Badge>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="청크 내용 검색..." 
                className="pl-9 h-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* 통합 헤더 */}
        <div className="px-6 py-3 border-b bg-muted/30 flex items-center justify-between shrink-0">
          <p className="text-sm font-medium text-muted-foreground">
            {filteredChunks.length === chunks.length 
              ? `전체 청크 ${chunks.length}개`
              : `검색 결과 ${filteredChunks.length}개`}
          </p>
          
          <div className="flex items-center gap-3">
            {onChunksChange && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setIsDeleteDialogOpen(true)}
                disabled={chunks.length <= 1}
                title={chunks.length <= 1 ? '마지막 청크는 삭제할 수 없습니다.' : undefined}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                청크 삭제
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevious}
              disabled={selectedIndex === 0}
            >
              <ChevronLeft className="h-4 w-4" />
              이전
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNext}
              disabled={selectedIndex === chunks.length - 1}
            >
              다음
              <ChevronRight className="h-4 w-4" />
            </Button>
            
            <div className="h-6 w-px bg-border" />
            
            <span className="text-xl font-bold text-primary">
              #{(selectedIndex + 1).toString().padStart(3, '0')}
            </span>
            <span className="text-sm text-muted-foreground">
              / {chunks.length}
            </span>
            
            <div className="h-6 w-px bg-border" />
            
            <Badge
              variant={(selectedChunk?.length ?? 0) > APP_CHUNK_LIMIT ? 'destructive' : 'outline'}
              className="text-sm"
            >
              {formatCharCount(selectedChunk?.length || 0)}
            </Badge>
          </div>
        </div>

        {/* 메인 콘텐츠 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 왼쪽: 청크 그리드 */}
          <div className="w-[45%] border-r overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-4 grid grid-cols-3 gap-3">
                {filteredChunks.map(({ content: chunk, originalIndex }) => {
                  const isSelected = selectedIndex === originalIndex;
                  
                  return (
                    <Card
                      key={originalIndex}
                      onClick={() => setSelectedIndex(originalIndex)}
                      className={`cursor-pointer transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/10 shadow-md ring-2 ring-primary'
                          : 'border-transparent hover:border-muted-foreground/20 hover:bg-muted/50'
                      }`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <span className={`text-lg font-bold ${
                            isSelected ? 'text-primary' : 'text-foreground'
                          }`}>
                            #{(originalIndex + 1).toString().padStart(3, '0')}
                          </span>
                          <Badge
                            variant={chunk.length > APP_CHUNK_LIMIT ? 'destructive' : 'secondary'}
                            className="text-xs"
                          >
                            {formatCharCount(chunk.length)}
                          </Badge>
                        </div>
                        
                        <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                          {chunk}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* 오른쪽: 청크 상세보기 */}
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-6">
                <div className="prose prose-sm max-w-none">
                  <div className="p-6 rounded-lg border-2 bg-muted/30 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed">
                    {selectedChunk || '선택된 청크가 없습니다.'}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>이 청크를 삭제하시겠습니까?</AlertDialogTitle>
          <AlertDialogDescription>
            청크 #{selectedIndex + 1}을 결과에서 삭제합니다. 삭제한 내용은 다시 전처리해야 복구할 수 있습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
