'use client';

import { usdText } from '@automarket/contracts';
import type { CopilotBlockDTO, VehicleCardDTO } from '@automarket/contracts';
import { Check, Database } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/shared/lib/cn';
import { MediaImage } from '@/shared/ui/media-image';
import { RichText } from '@/shared/ui/rich-text';

const money = (value: number | string) => usdText(Number(value));
const kmText = (km: number) => `${km.toLocaleString('es-VE')} km`;
const clamp = (value: number) => Math.max(3, Math.min(97, value));

/** Foto del anuncio o, si no tiene, un rectángulo gris con la silueta de un auto. */
function Thumb({ vehicle, rank }: { vehicle: VehicleCardDTO; rank?: number }) {
  return (
    <span className="relative h-[60px] w-[84px] shrink-0 overflow-hidden rounded-[12px] bg-sunken">
      {vehicle.coverUrl ? (
        <MediaImage src={vehicle.coverUrl} alt="" fill sizes="84px" className="object-cover" />
      ) : (
        <svg aria-hidden viewBox="0 0 84 60" className="absolute inset-0 size-full">
          <path d="M14 40h56v-6c0-3-2-5-5-6l-9-2-7-8c-1-1-3-2-5-2H33c-2 0-4 1-5 2l-6 8-5 1c-2 1-3 3-3 5z" fill="currentColor" className="text-edge" />
          <circle cx="27" cy="41" r="6" className="fill-ink/70" />
          <circle cx="58" cy="41" r="6" className="fill-ink/70" />
        </svg>
      )}
      {rank !== undefined && <span className="absolute top-1 left-1 grid size-5 place-items-center rounded-full bg-night text-[11px] font-extrabold text-white">{rank}</span>}
    </span>
  );
}

function Picks({ block, onNavigate }: { block: Extract<CopilotBlockDTO, { type: 'picks' }>; onNavigate: () => void }) {
  return (
    <ol className="grid w-full gap-2">
      {block.items.map((item, i) => {
        const v = item.vehicle;
        const meta = item.reasons[item.reasons.length - 1];
        return (
          <li key={v.id} className="rounded-[16px] border border-line bg-surface p-2.5">
            <div className="flex gap-2.5">
              <Thumb vehicle={v} rank={i + 1} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">
                  {v.make} {v.model} {v.year}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="figures text-[15px] font-extrabold">{money(v.price)}</span>
                  {item.tag && <span className="inline-flex h-[22px] items-center rounded-full bg-soft px-2 text-[11.5px] font-bold text-brand-fg">{item.tag}</span>}
                </p>
                {meta && <p className="mt-0.5 truncate text-[12.5px] text-muted">{meta}</p>}
              </div>
            </div>
            {item.reasons.length > 1 && (
              <ul className="mt-2 grid gap-1">
                {item.reasons.slice(0, -1).map(reason => (
                  <li key={reason} className="flex gap-1.5 text-[13px] leading-snug text-ink/80">
                    <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted" strokeWidth={2.4} />
                    {reason}
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/vehiculos/${v.slug}`} onClick={onNavigate} className="mt-2 inline-flex h-9 items-center rounded-full border border-edge px-3 text-[13px] font-bold hover:border-ink">
              Ver ficha
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function Gauge({ block }: { block: Extract<CopilotBlockDTO, { type: 'gauge' }> }) {
  const span = Math.max(1, block.scale.max - block.scale.min);
  const at = (value: number) => clamp(((value - block.scale.min) / span) * 100);
  const low = at(block.band.low);
  const high = at(block.band.high);
  const chip = block.tone === 'good' ? 'bg-success-soft text-success-fg' : block.tone === 'warn' ? 'bg-gold-soft text-gold-fg' : 'bg-tile text-ink';
  return (
    <div className="w-full rounded-[16px] border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <p className="text-sm font-bold">{block.title}</p>
          <p className="text-[12.5px] text-muted">{block.subtitle}</p>
        </div>
        <span className={cn('inline-flex h-[26px] shrink-0 items-center rounded-full px-2.5 text-xs font-extrabold whitespace-nowrap', chip)}>{block.verdict}</span>
      </div>
      <div aria-hidden className={cn('mx-1', block.price !== null ? 'mt-9' : 'mt-4')}>
        <div className="relative">
          <div className="flex h-2.5 overflow-hidden rounded-full">
            <span className="bg-success-soft" style={{ width: `${low}%` }} />
            <span className="bg-line" style={{ width: `${high - low}%` }} />
            <span className="flex-1 bg-gold-soft" />
          </div>
          {block.price !== null && (
            <>
              <span className="absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-surface bg-ink" style={{ left: `${at(block.price)}%` }} />
              <span className="absolute bottom-[calc(100%+10px)] -translate-x-1/2 rounded-[7px] bg-ink px-2 py-0.5 font-mono text-[11px] font-medium whitespace-nowrap text-surface" style={{ left: `clamp(40px, ${at(block.price)}%, calc(100% - 40px))` }}>
                {money(block.price)}
              </span>
            </>
          )}
        </div>
        <div className="mt-2.5 flex justify-between text-[11.5px] text-muted">
          <span>Bajo</span>
          <span>
            Justo: {money(block.band.low)} – {money(block.band.high)}
          </span>
          <span>Alto</span>
        </div>
      </div>
      <dl className="mt-3 grid gap-1.5 border-t border-line pt-2.5 text-[13px]">
        {block.rows.map(row => (
          <div key={row.label} className="flex justify-between gap-3">
            <dt className="text-muted">{row.label}</dt>
            <dd className="figures text-right font-bold">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Gearbox({ block, onNavigate }: { block: Extract<CopilotBlockDTO, { type: 'gearbox' }>; onNavigate: () => void }) {
  const top = Math.max(...block.groups.map(group => group.avg)) * 1.05;
  return (
    <div className="w-full rounded-[16px] border border-line bg-surface p-3.5">
      <p className="text-sm font-bold">{block.title}</p>
      <div className="mt-2.5 grid gap-2">
        {block.groups.map(group => (
          <div key={group.label}>
            <div className="flex justify-between text-[12.5px]">
              <span className="font-semibold">
                {group.label} · {group.count} {group.count === 1 ? 'auto' : 'autos'}
              </span>
              <span className="figures font-bold">{money(group.avg)}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-line">
              <div className={cn('h-2 rounded-full', group.label === 'Automático' ? 'bg-ink' : 'bg-brand')} style={{ width: `${(group.avg / top) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <ul className="mt-3 divide-y divide-line border-t border-line">
        {block.rows.map(row => (
          <li key={row.vehicle.id}>
            <Link href={`/vehiculos/${row.vehicle.slug}`} onClick={onNavigate} className="flex items-center justify-between gap-3 py-2 hover:opacity-80">
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold">
                  {row.vehicle.year} {row.vehicle.version ?? ''} <span className="font-normal text-muted">· {row.vehicle.transmission === 'MANUAL' ? 'Sincrónico' : 'Automático'}</span>
                </span>
                <span className="block text-xs text-muted">
                  {kmText(row.vehicle.mileageKm)} · {row.vehicle.city}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="figures block text-sm font-extrabold">{money(row.vehicle.price)}</span>
                {row.cheapest && <span className="block text-[11px] font-bold text-brand-fg">El más barato</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Versus({ block }: { block: Extract<CopilotBlockDTO, { type: 'versus' }> }) {
  return (
    <div className="w-full overflow-hidden rounded-[16px] border border-line bg-surface text-[13px]">
      <div className="grid grid-cols-[1.1fr_1fr_1fr] bg-tile px-3 py-2 font-bold">
        <span />
        <span>{block.columns[0]}</span>
        <span>{block.columns[1]}</span>
      </div>
      {block.rows.map(row => (
        <div key={row.label} className="grid grid-cols-[1.1fr_1fr_1fr] border-t border-line px-3 py-1.5">
          <span className="text-muted">{row.label}</span>
          <span className="figures font-semibold">{row.values[0]}</span>
          <span className="figures font-semibold">{row.values[1]}</span>
        </div>
      ))}
    </div>
  );
}

/** Un bloque de la respuesta: texto, autos, medidor de precio, cajas, comparación o nota. */
export function CopilotBlock({ block, onNavigate }: { block: CopilotBlockDTO; onNavigate: () => void }) {
  if (block.type === 'text') return <RichText text={block.text} className="max-w-[88%] rounded-[16px] rounded-tl-[6px] bg-tile px-3.5 py-2.5 text-[14.5px] leading-[1.45]" />;
  if (block.type === 'note')
    return (
      <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
        <Database aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
        {block.text}
      </p>
    );
  if (block.type === 'picks') return <Picks block={block} onNavigate={onNavigate} />;
  if (block.type === 'gauge') return <Gauge block={block} />;
  if (block.type === 'gearbox') return <Gearbox block={block} onNavigate={onNavigate} />;
  return <Versus block={block} />;
}
