export interface IndexedChunk {
  content: string;
  originalIndex: number;
}

export interface RemoveChunkResult {
  chunks: string[];
  selectedIndex: number;
}

export function filterIndexedChunks(chunks: string[], searchQuery: string): IndexedChunk[] {
  const query = searchQuery.trim().toLowerCase();
  return chunks.flatMap((content, originalIndex) => {
    const chunkNumber = `#${(originalIndex + 1).toString().padStart(3, '0')}`;
    if (query && !content.toLowerCase().includes(query) && !chunkNumber.includes(query)) {
      return [];
    }
    return [{ content, originalIndex }];
  });
}

export function removeChunkAt(chunks: string[], index: number): RemoveChunkResult {
  if (chunks.length <= 1) {
    throw new RangeError('마지막 청크는 삭제할 수 없습니다.');
  }
  if (!Number.isInteger(index) || index < 0 || index >= chunks.length) {
    throw new RangeError('삭제할 청크 번호가 올바르지 않습니다.');
  }

  return {
    chunks: chunks.filter((_, chunkIndex) => chunkIndex !== index),
    selectedIndex: Math.min(index, chunks.length - 2),
  };
}
