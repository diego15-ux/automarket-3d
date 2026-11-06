'use client';

import { VEHICLE_CATEGORIES } from '@automarket/contracts';
import { ChevronDown, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { CATEGORY_PLURALS } from '@/features/landing/categories';
import { formatMoney } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';

const PRICE_CAPS = [10_000, 20_000, 30_000, 50_000, 100_000];

/** Búsqueda rápida de la portada (como el index.html): lleva al catálogo con los filtros puestos. */
export function HeroSearch() {
  const router = useRouter();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of ['q', 'category', 'priceMax'] as const) {
      const value = String(data.get(key) ?? '').trim();
      if (value) params.set(key, value);
    }
    router.push(`/vehiculos${params.size ? `?${params}` : ''}`);
  }

  const control = 'h-12 w-full rounded-[0.9rem] border border-line bg-sunken text-[0.9rem] text-ink transition-colors focus:border-brand-fg focus:outline-none';
  const select = `${control} cursor-pointer appearance-none truncate pr-9 pl-4`;
  const chevron = <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />;

  return (
    <form
      onSubmit={onSubmit}
      role="search"
      aria-label="Búsqueda rápida de vehículos"
      className="mt-10 grid gap-2.5 rounded-2xl border border-line bg-surface p-2.5 shadow-[0_30px_60px_-30px_rgb(0_0_0/0.45)] sm:grid-cols-[1.5fr_1fr_1fr_auto]"
    >
      <div className="relative">
        <label htmlFor="hs-q" className="sr-only">
          Marca o modelo
        </label>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted" />
        <input id="hs-q" name="q" type="search" placeholder="Marca o modelo" autoComplete="off" className={`${control} pr-3 pl-10 placeholder:text-muted/80`} />
      </div>
      <div className="relative">
        <label htmlFor="hs-cat" className="sr-only">
          Categoría
        </label>
        <select id="hs-cat" name="category" defaultValue="" className={select}>
          <option value="">Categoría</option>
          {VEHICLE_CATEGORIES.map(category => (
            <option key={category} value={category}>
              {CATEGORY_PLURALS[category]}
            </option>
          ))}
        </select>
        {chevron}
      </div>
      <div className="relative">
        <label htmlFor="hs-price" className="sr-only">
          Precio máximo
        </label>
        <select id="hs-price" name="priceMax" defaultValue="" className={select}>
          <option value="">Precio máx.</option>
          {PRICE_CAPS.map(cap => (
            <option key={cap} value={cap}>
              Hasta {formatMoney(cap, 'USD')}
            </option>
          ))}
        </select>
        {chevron}
      </div>
      <Button type="submit" size="lg" className="h-12 px-6 text-sm">
        Buscar
      </Button>
    </form>
  );
}
