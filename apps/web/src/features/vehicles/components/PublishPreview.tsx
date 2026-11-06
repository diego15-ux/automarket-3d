'use client';

import { Camera } from 'lucide-react';
import { kilometers, money, toNumber, type PublishForm } from '../publish-form';

export interface PriceVerdict {
  label: string;
  tone: 'ok' | 'warn' | 'muted';
}

const toneChip = { ok: 'bg-success-soft text-success-fg', warn: 'bg-gold-soft text-gold-fg', muted: 'bg-tile text-muted' } as const;

/** Tarjeta tal como saldrá en el catálogo, con los datos reales que lleva el vendedor. */
export function PublishPreviewCard({ form, coverUrl, photos, verified, verdict }: { form: PublishForm; coverUrl: string | null; photos: number; verified: boolean; verdict: PriceVerdict | null }) {
  const title = form.make && form.model ? `${form.make} ${form.model}${form.version.trim() ? ' ' + form.version.trim() : ''}` : 'Tu auto';
  const specs = [form.year, form.condition === 'NEW' ? '0 km' : form.km ? kilometers(form.km) : '', form.city.trim()].filter(Boolean).join(' · ') || 'Año · km · ciudad';
  const price = toNumber(form.price);
  return (
    <article aria-label="Vista previa del anuncio" className="overflow-hidden rounded-[22px] border border-line bg-surface">
      <div className="relative aspect-[16/10] bg-card-tile">
        {coverUrl ? (
          // Puede ser una vista previa local (blob:) o la foto ya subida.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-content-center justify-items-center gap-1.5 text-[13px] text-muted">
            <Camera className="size-[22px]" strokeWidth={2} aria-hidden />
            Tu foto de portada va aquí
          </div>
        )}
        {verified && (
          <span className="absolute top-2.5 left-2.5 inline-flex h-6 items-center gap-[5px] rounded-full bg-[rgb(10_11_11/0.72)] px-[9px] font-mono text-[11px] font-semibold text-[#7cc79a]">✓ Verificado</span>
        )}
        <span className="absolute right-2.5 bottom-2.5 inline-flex h-6 items-center rounded-full bg-[rgb(10_11_11/0.72)] px-[9px] text-xs font-semibold text-white">
          {photos} {photos === 1 ? 'foto' : 'fotos'}
        </span>
      </div>
      <div className="px-4 pt-3.5 pb-4">
        <p className="text-base font-extrabold">{title}</p>
        <p className="mt-[3px] text-[13.5px] text-muted">{specs}</p>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="text-xl font-extrabold">{price ? money(price) : '$ —'}</span>
          {verdict && price > 0 && <span className={`inline-flex h-[26px] items-center rounded-full px-2.5 text-[12.5px] font-bold ${toneChip[verdict.tone]}`}>{verdict.label}</span>}
        </div>
      </div>
    </article>
  );
}

/** Cuánto le falta al anuncio (fotos claras, precio y kilometraje son lo que más miran). */
export function PublishProgressCard({ pct }: { pct: number }) {
  return (
    <div className="rounded-[18px] border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-bold">{pct >= 100 ? 'Anuncio completo' : pct >= 70 ? 'Casi listo' : 'Sigue llenando'}</span>
        <span className="font-mono text-[13px] font-semibold">{pct} %</span>
      </div>
      <span aria-hidden className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-line">
        <span className="block h-full bg-brand transition-[width] duration-400" style={{ width: `${pct}%` }} />
      </span>
      <p className="mt-3 text-[13.5px] leading-[1.45] text-muted">Lo que más miran los compradores: fotos claras, precio justo y el kilometraje real.</p>
    </div>
  );
}
