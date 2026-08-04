'use client';

import { useCallback, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const SCALE_STEP = 1.25;

const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

type GuideImageLightboxProps = {
  src: string;
  alt: string;
  /** 본문에 인라인으로 표시되는 이미지의 클래스 */
  className?: string;
};

/** 클릭하면 확대·축소와 이동이 가능한 이미지 뷰어를 여는 도움말 이미지. */
export function GuideImageLightbox({ src, alt, className }: GuideImageLightboxProps) {
  const [scale, setScale] = useState(MIN_SCALE);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

  const reset = useCallback(() => {
    setScale(MIN_SCALE);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setScale((current) => {
      const next = clampScale(current * factor);
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  return (
    <Dialog onOpenChange={(open) => { if (!open) reset(); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="block w-full cursor-zoom-in"
          aria-label={`${alt} 크게 보기`}
        >
          <img src={src} alt={alt} loading="lazy" className={className} />
        </button>
      </DialogTrigger>
      <DialogContent
        className="flex h-[92vh] max-w-[96vw] flex-col gap-2 overflow-hidden p-2 sm:max-w-[96vw]"
        onWheel={(event) => zoomBy(event.deltaY < 0 ? SCALE_STEP : 1 / SCALE_STEP)}
      >
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <DialogDescription className="sr-only">
          마우스 휠 또는 아래 버튼으로 확대·축소하고, 확대 상태에서 드래그해 이동할 수 있습니다.
        </DialogDescription>
        <div className="relative flex-1 overflow-hidden rounded-md bg-muted/30">
          <img
            src={src}
            alt={alt}
            draggable={false}
            className={`h-full w-full select-none object-contain ${scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transition: dragState.current ? 'none' : 'transform 120ms ease-out',
            }}
            onDoubleClick={() => (scale > 1 ? reset() : zoomBy(2))}
            onPointerDown={(event) => {
              if (scale <= 1) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragState.current = {
                pointerId: event.pointerId,
                startX: event.clientX - offset.x,
                startY: event.clientY - offset.y,
              };
            }}
            onPointerMove={(event) => {
              const drag = dragState.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              setOffset({ x: event.clientX - drag.startX, y: event.clientY - drag.startY });
            }}
            onPointerUp={() => { dragState.current = null; }}
            onPointerCancel={() => { dragState.current = null; }}
          />
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button type="button" variant="outline" size="icon" aria-label="축소" onClick={() => zoomBy(1 / SCALE_STEP)}>
            <Minus />
          </Button>
          <span className="w-14 text-center text-sm tabular-nums text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <Button type="button" variant="outline" size="icon" aria-label="확대" onClick={() => zoomBy(SCALE_STEP)}>
            <Plus />
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label="원래 크기로" onClick={reset}>
            <RotateCcw />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
