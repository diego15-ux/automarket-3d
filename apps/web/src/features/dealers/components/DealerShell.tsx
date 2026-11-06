'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CarFront, CreditCard, ExternalLink, Home, LayoutGrid, LogOut, MessageCircle, Megaphone, Plus, Store } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { authApi } from '@/features/auth/api';
import { cn } from '@/shared/lib/cn';
import { initials } from '@/shared/lib/format';
import { Logo } from '@/shared/ui/logo';
import { SteeringWheel } from '@/shared/ui/steering-wheel';
import { dealerKeys, dealersApi } from '../api';

/**
 * Marco del panel del concesionario (diseños «concesionario-pc» y «concesionario-movil»): menú
 * lateral oscuro en PC con la agencia y su cupo de destacados; barra inferior en el teléfono.
 */
export function DealerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const dashboard = useQuery({ queryKey: dealerKeys.dashboard, queryFn: dealersApi.dashboard, retry: false });
  const data = dashboard.data;
  const nav = [
    { href: '/concesionario', label: 'Resumen', icon: LayoutGrid, badge: null },
    { href: '/concesionario/copiloto', label: 'Copiloto', icon: SteeringWheel, badge: null },
    { href: '/cuenta/anuncios', label: 'Inventario', icon: CarFront, badge: data?.badges.activeListings },
    { href: '/mensajes', label: 'Mensajes', icon: MessageCircle, badge: data?.badges.unreadMessages },
    { href: '/cuenta/reservas', label: 'Reservas', icon: CalendarCheck, badge: data?.badges.pendingReservations },
    { href: '/cuenta/anuncios#destacar', label: 'Destacados', icon: Megaphone, badge: null },
    { href: data ? `/vendedores/${data.dealer.id}` : '/concesionarios', label: 'Mi página', icon: Store, badge: null },
    { href: '/cuenta/plan', label: 'Plan y pagos', icon: CreditCard, badge: null },
  ];
  const slots = data?.plan.featuredSlots ?? 0;
  const used = data?.plan.featuredInUse ?? 0;

  return (
    <div className="flex min-h-dvh bg-canvas text-ink">
      <aside aria-label="Menú del concesionario" className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col gap-5 overflow-y-auto bg-night px-3.5 pt-[22px] pb-6 text-[#F2F3F5] lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <Logo href="/" tone="night" />
          <span className="ml-auto inline-flex h-[22px] items-center rounded-full border border-[#2E3238] px-2 font-mono text-[10.5px] text-[#A2A7B0]">Agencia</span>
        </div>
        {data && (
          <div className="rounded-[20px] border border-night-line bg-night-2 p-4">
            <div className="flex items-center gap-3">
              <span className="grid size-[52px] shrink-0 place-items-center rounded-2xl bg-[#F2F3F5] text-lg font-extrabold text-[#0E0F11]">{initials(data.dealer.name)}</span>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-extrabold">{data.dealer.name}</p>
                {data.dealer.taxId && <p className="mt-0.5 font-mono text-[11px] text-[#A2A7B0]">RIF {data.dealer.taxId}</p>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.dealer.verified && <span className="inline-flex h-6 items-center gap-1 rounded-full bg-success-soft px-[9px] text-[11.5px] font-extrabold text-success-fg">✓ Verificado</span>}
              <span className="inline-flex h-6 items-center rounded-full bg-brand px-[9px] text-[11.5px] font-extrabold text-on-brand">{data.dealer.planName.replace('Concesionario ', 'Plan ')}</span>
            </div>
          </div>
        )}
        <nav aria-label="Secciones" className="flex flex-col gap-0.5">
          {nav.map(item => {
            const active = item.href.startsWith('/concesionario') ? pathname === item.href : false;
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn('flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-[180ms]', active ? 'bg-[#1D2024] font-bold text-[#F2F3F5]' : 'font-medium text-[#A2A7B0] hover:bg-[#17191c] hover:text-[#F2F3F5]')}
              >
                <Icon className={cn('size-[19px]', active && 'text-mint')} strokeWidth={1.8} aria-hidden />
                <span className="flex-1">{item.label}</span>
                {!!item.badge && <span className="inline-grid h-[22px] min-w-[22px] place-items-center rounded-full bg-brand px-1.5 font-mono text-[11px] text-on-brand">{item.badge}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          {data && (slots > 0 || data.plan.monthlyCredits > 0) && (
            <div className="rounded-[18px] border border-night-line bg-night-2 p-3.5">
              <p className="text-[13px] font-extrabold">{slots > 1 ? 'Destacados del plan' : 'Destacado del mes'}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#272A2F]">
                <span className="block h-full rounded-full bg-brand transition-[width] duration-500 ease-[cubic-bezier(.2,.9,.25,1)]" style={{ width: `${slots ? Math.min(100, (used / slots) * 100) : data.plan.creditUsedThisMonth ? 100 : 0}%` }} />
              </div>
              <p className="mt-1.5 font-mono text-[11.5px] text-[#A2A7B0]">
                {data.plan.monthlyCredits > 0
                  ? data.plan.creditUsedThisMonth
                    ? 'Ya usaste el de este mes'
                    : 'Te queda 1 este mes'
                  : `${used} de ${slots} en uso · te ${slots - used === 1 ? 'queda 1' : `quedan ${Math.max(0, slots - used)}`}`}
              </p>
            </div>
          )}
          <div className="flex flex-col gap-0.5 border-t border-night-line pt-3">
            <Link href="/" className="flex h-11 items-center gap-3 rounded-xl px-3 text-sm text-[#A2A7B0] hover:bg-[#17191c] hover:text-white">
              <ExternalLink className="size-[19px]" strokeWidth={1.8} aria-hidden />
              Ver el sitio
            </Link>
            <button type="button" onClick={() => void authApi.logout().then(() => router.push('/login'))} className="flex h-11 items-center gap-3 rounded-xl px-3 text-left text-sm text-[#A2A7B0] hover:bg-[#17191c] hover:text-white">
              <LogOut className="size-[19px]" strokeWidth={1.8} aria-hidden />
              Cerrar sesión
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-[96px] lg:pb-0">{children}</div>

      <nav aria-label="Panel" className="fixed inset-x-0 bottom-0 z-30 grid h-[84px] grid-cols-5 items-center border-t border-line bg-surface pb-[max(14px,env(safe-area-inset-bottom))] lg:hidden dark:border-[#25282d] dark:bg-[#121316]">
        {[
          { href: '/concesionario', label: 'Inicio', icon: Home, active: pathname === '/concesionario' },
          { href: '/cuenta/anuncios', label: 'Autos', icon: CarFront },
          null,
          { href: '/mensajes', label: 'Mensajes', icon: MessageCircle, badge: data?.badges.unreadMessages },
          { href: '/cuenta', label: 'Más', icon: LayoutGrid },
        ].map((item, index) =>
          item === null ? (
            <Link key="publicar" href="/cuenta/anuncios/nuevo" aria-label="Publicar auto" className="mx-auto grid size-[52px] place-items-center rounded-full bg-brand text-white dark:bg-brand dark:text-on-brand">
              <Plus className="size-[22px]" strokeWidth={2.4} aria-hidden />
            </Link>
          ) : (
            <Link key={index} href={item.href} aria-current={item.active ? 'page' : undefined} className={cn('relative flex flex-col items-center gap-1 text-[11px]', item.active ? 'font-semibold text-ink' : 'font-medium text-muted')}>
              <item.icon className="size-[22px]" strokeWidth={1.8} aria-hidden />
              {item.label}
              {!!item.badge && <span className="absolute -top-1 left-[calc(50%+6px)] inline-grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 font-mono text-[10px] text-white dark:bg-brand dark:text-on-brand">{item.badge}</span>}
            </Link>
          ),
        )}
      </nav>
    </div>
  );
}
