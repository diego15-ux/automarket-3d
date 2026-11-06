'use client';

import type { VehicleMediaDTO } from '@automarket/contracts';
import { ChevronLeft, ChevronRight, Images, Play } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { MediaImage } from '@/shared/ui/media-image';

/** Galería completa de la ficha: fotos y vídeos (con reproductor nativo) + miniaturas. */
export function MediaGallery({ media, title }: { media: VehicleMediaDTO[]; title: string }) {
  const [index, setIndex] = useState(0);
  const current = media[index];
  if (!current) {
    return (
      <div className="grid aspect-[16/10] place-items-center rounded-sm bg-sunken text-muted">
        <Images className="size-8" />
      </div>
    );
  }
  const go = (delta: number) => setIndex(value => (value + delta + media.length) % media.length);

  return (
    <div>
      <div className="relative aspect-[16/10] overflow-hidden rounded-sm bg-black">
        {current.kind === 'VIDEO' ? (
          // key: al cambiar de vídeo el reproductor se reinicia
          <video key={current.id} src={current.url} controls playsInline preload="metadata" className="size-full object-contain" aria-label={`Vídeo de ${title}`} />
        ) : (
          <MediaImage src={current.url} alt={`${title} · foto ${index + 1} de ${media.length}`} fill priority sizes="(min-width: 1024px) 60vw, 100vw" className="object-cover" />
        )}
        {media.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Anterior" className="absolute top-1/2 left-3 grid size-10 -translate-y-1/2 place-items-center rounded-sm bg-black/60 text-white transition-colors hover:bg-black/80">
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Siguiente" className="absolute top-1/2 right-3 grid size-10 -translate-y-1/2 place-items-center rounded-sm bg-black/60 text-white transition-colors hover:bg-black/80">
              <ChevronRight className="size-5" />
            </button>
            <span className="absolute right-3 bottom-3 rounded-[2px] bg-black/65 px-2 py-0.5 text-xs text-white figures">
              {index + 1} / {media.length}
            </span>
          </>
        )}
      </div>
      {media.length > 1 && (
        <div className="scrollbar-none -mx-1 mt-2 flex gap-2 overflow-x-auto p-1" role="tablist" aria-label="Miniaturas">
          {media.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${item.kind === 'VIDEO' ? 'Vídeo' : 'Foto'} ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn('relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-[2px] bg-sunken outline-offset-2 transition-opacity', i === index ? 'outline-2 outline-ink' : 'opacity-60 hover:opacity-100')}
            >
              {item.kind === 'VIDEO' ? (
                <span className="grid size-full place-items-center bg-black/85 text-white">
                  <Play className="size-5" />
                </span>
              ) : (
                <MediaImage src={item.url} alt="" fill sizes="96px" className="object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
