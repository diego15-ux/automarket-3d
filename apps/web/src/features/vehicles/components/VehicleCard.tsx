import { FUEL_LABELS, type VehicleCardDTO } from '@automarket/contracts';
import { BadgeCheck, Building2, MapPin } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/shared/lib/cn';
import { formatKm, formatMoney } from '@/shared/lib/format';
import { MediaImage } from '@/shared/ui/media-image';

export interface CardCompare {
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}

export interface CardWatch {
  watching: boolean;
  busy?: boolean;
  onToggle: () => void;
}

/**
 * Tarjeta del catálogo (diseño «Catálogo con filtros»): blanca, 20 px de radio, etiquetas en
 * píldora sobre la foto, aviso de negociación y, en el catálogo, casilla para comparar.
 */
export function VehicleCard({
  vehicle,
  className,
  priority = false,
  layout = 'grid',
  featuredLabel,
  compare,
  watch,
}: {
  vehicle: VehicleCardDTO;
  className?: string;
  priority?: boolean;
  layout?: 'grid' | 'list';
  /** null oculta la etiqueta aunque el anuncio esté destacado (fuera de su turno). */
  featuredLabel?: string | null;
  compare?: CardCompare;
  watch?: CardWatch;
}) {
  const href = `/vehiculos/${vehicle.slug}`;
  const name = `${vehicle.make} ${vehicle.model}${vehicle.version ? ` ${vehicle.version}` : ''}`;
  // Reservado: alguien pagó el abono. En negociación: además, el dueño está cerrando la venta.
  const negotiating = vehicle.status === 'RESERVED';
  const closing = negotiating && vehicle.inNegotiation;
  const sold = vehicle.status === 'SOLD';
  const gearbox = vehicle.transmission === 'MANUAL' ? 'Manual' : 'Automática';
  const specs = [String(vehicle.year), formatKm(vehicle.mileageKm), gearbox.toLowerCase(), FUEL_LABELS[vehicle.fuelType].toLowerCase()].join(', ');
  const featured = featuredLabel === undefined ? (vehicle.isFeatured ? 'Destacado' : null) : featuredLabel;
  const list = layout === 'list';

  return (
    <article
      className={cn(
        'flex overflow-hidden rounded-[20px] border bg-surface transition-[border-color,box-shadow] duration-200',
        list ? 'flex-col sm:flex-row' : 'flex-col',
        compare?.selected ? 'border-ink shadow-[0_12px_28px_-18px_rgb(17_19_18/0.5)]' : 'border-line hover:border-edge',
        className,
      )}
    >
      <Link href={href} tabIndex={-1} aria-hidden className={cn('relative block aspect-[4/3] shrink-0 overflow-hidden bg-card-tile', list && 'sm:w-[260px]')}>
        {vehicle.coverUrl ? (
          <MediaImage
            src={vehicle.coverUrl}
            alt=""
            fill
            priority={priority}
            sizes={list ? '260px' : '(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw'}
            className={cn('object-cover transition-transform duration-500 ease-out hover:scale-[1.025]', sold && 'opacity-55 grayscale')}
          />
        ) : (
          <div className="grid h-full place-items-center text-[13px] text-muted">Sin foto</div>
        )}
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          {featured && <span className="inline-flex h-[26px] items-center rounded-full bg-surface px-2.5 text-xs font-bold text-ink">{featured}</span>}
          {negotiating && (
            <span className={cn('inline-flex h-[26px] items-center rounded-full px-2.5 text-xs font-bold', closing ? 'bg-[#FFF4DB] text-[#8A5A00]' : 'bg-[#EEF2FF] text-[#3730A3]')}>{closing ? 'En negociación' : 'Reservado'}</span>
          )}
        </div>
        {sold && (
          <span className="absolute inset-0 grid place-items-center">
            <span className="-rotate-6 rounded-full bg-ink px-[18px] py-2 text-sm font-extrabold tracking-[0.06em] text-surface">VENDIDO</span>
          </span>
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1 px-4 pt-3.5 pb-4">
        <div className="flex items-baseline justify-between gap-2.5">
          <h3 className="min-w-0 truncate text-[15px] font-bold">
            <Link href={href} className="hover:underline hover:underline-offset-4">
              {name}
            </Link>
          </h3>
          <p className="shrink-0 text-base font-extrabold whitespace-nowrap">{formatMoney(vehicle.price, vehicle.currency)}</p>
        </div>
        <p className="text-[13.5px] text-muted">{specs}</p>
        {negotiating && (
          <div className="mt-1 flex flex-wrap items-center gap-2 rounded-[12px] bg-gold-soft px-2.5 py-2 text-[12.5px] leading-[1.4] text-[#5c3d00] dark:text-gold-fg">
            <span className="flex-[1_1_160px]">{closing ? 'Se está cerrando la venta.' : 'Ya tiene una reserva.'}</span>
            {watch && (
              <button
                type="button"
                aria-pressed={watch.watching}
                disabled={watch.busy}
                onClick={watch.onToggle}
                className="min-h-8 rounded-full border border-[#c9a35a] bg-surface px-2.5 text-xs font-bold text-[#5c3d00] disabled:opacity-60 dark:text-gold-fg"
              >
                {watch.watching ? 'Te avisamos si vuelve' : 'Avísame si vuelve'}
              </button>
            )}
          </div>
        )}
        <p className="flex min-w-0 items-center gap-[5px] text-[13.5px] text-muted">
          <MapPin className="size-[13px] shrink-0" aria-hidden />
          <span className="truncate">
            {vehicle.city}
            {typeof vehicle.distanceKm === 'number' ? `, a ${vehicle.distanceKm} km` : ''}
          </span>
          {vehicle.sellerDealerName && (
            <span className="flex min-w-0 items-center gap-1" title={`Concesionario: ${vehicle.sellerDealerName}`}>
              <span aria-hidden>·</span>
              <Building2 className="size-3.5 shrink-0" aria-label="Concesionario" />
              <span className="truncate">{vehicle.sellerDealerName}</span>
            </span>
          )}
        </p>
        {(compare || vehicle.sellerVerified) && (
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-line/70 pt-2.5">
            {compare ? (
              <label className={cn('flex min-h-10 items-center gap-2 text-[13.5px] font-semibold', compare.disabled ? 'cursor-not-allowed text-faint' : 'cursor-pointer')}>
                <input type="checkbox" checked={compare.selected} disabled={compare.disabled} onChange={compare.onToggle} className="size-[18px] accent-brand" />
                Comparar
              </label>
            ) : (
              <span />
            )}
            {vehicle.sellerVerified && (
              <span className="inline-flex items-center gap-1 text-[12.5px] font-bold text-success-fg" title="El vendedor verificó su identidad">
                <BadgeCheck className="size-3.5" strokeWidth={2.2} aria-hidden /> Verificado
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
