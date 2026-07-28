export interface PositionedMarkdownNode {
  type: string;
  position?: {
    start?: {
      offset?: number;
    };
  };
}

export interface ChunkBoundarySelection {
  chunkIndex: number;
  offset: number;
}

export interface RenderedChunkBoundary extends ChunkBoundarySelection {
  clientY: number;
}

export function getTopLevelBoundaryOffsets(
  nodes: PositionedMarkdownNode[],
): number[] {
  const offsets: number[] = [];

  for (let index = 1; index < nodes.length; index += 1) {
    const node = nodes[index];
    const offset = node.position?.start?.offset;

    if (typeof offset !== 'number' || offset <= 0) continue;

    const previousNode = nodes[index - 1];
    const separatesHeadingFromBody =
      previousNode?.type === 'heading' && node.type !== 'heading';

    if (!separatesHeadingFromBody) offsets.push(offset);
  }

  return offsets;
}

export function selectNearestRenderedBoundary<T extends RenderedChunkBoundary>(
  boundaries: T[],
  pointerY: number,
): T | null {
  let nearest: T | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const boundary of boundaries) {
    const distance = Math.abs(boundary.clientY - pointerY);
    if (distance < nearestDistance) {
      nearest = boundary;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function joinMarkdownBlocks(left: string, right: string): string {
  const normalizedLeft = left.trimEnd();
  const normalizedRight = right.trimStart();

  if (!normalizedLeft) return normalizedRight;
  if (!normalizedRight) return normalizedLeft;

  return `${normalizedLeft}\n\n${normalizedRight}`;
}

export function applyChunkBoundary(
  chunks: string[],
  draggingIndex: number,
  selection: ChunkBoundarySelection,
): string[] | null {
  const previousChunkIndex = draggingIndex - 1;
  const currentChunkIndex = draggingIndex;

  if (
    previousChunkIndex < 0 ||
    currentChunkIndex >= chunks.length ||
    (selection.chunkIndex !== previousChunkIndex &&
      selection.chunkIndex !== currentChunkIndex)
  ) {
    return null;
  }

  const targetChunk = chunks[selection.chunkIndex];
  if (selection.offset <= 0 || selection.offset >= targetChunk.length) {
    return null;
  }

  const previousChunk = chunks[previousChunkIndex];
  const currentChunk = chunks[currentChunkIndex];
  let newPreviousChunk: string;
  let newCurrentChunk: string;

  if (selection.chunkIndex === previousChunkIndex) {
    newPreviousChunk = previousChunk.slice(0, selection.offset).trimEnd();
    const movedBlocks = previousChunk.slice(selection.offset).trimStart();
    newCurrentChunk = joinMarkdownBlocks(movedBlocks, currentChunk);
  } else {
    const movedBlocks = currentChunk.slice(0, selection.offset).trimEnd();
    newPreviousChunk = joinMarkdownBlocks(previousChunk, movedBlocks);
    newCurrentChunk = currentChunk.slice(selection.offset).trimStart();
  }

  if (!newPreviousChunk || !newCurrentChunk) return null;

  const nextChunks = [...chunks];
  nextChunks[previousChunkIndex] = newPreviousChunk;
  nextChunks[currentChunkIndex] = newCurrentChunk;
  return nextChunks;
}
