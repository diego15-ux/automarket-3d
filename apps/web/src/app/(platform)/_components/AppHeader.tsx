'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserMenu } from '@/features/auth';
import { ChatConnection, useUnreadCount } from '@/features/chat';
import { ExpiryBanner } from '@/features/memberships/components/ExpiryBanner';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { SmartSearchBar } from '@/features/vehicles/components/SmartSearchBar';
import { cn } from '@/shared/lib/cn';
import { useSession } from '@/shared/lib/use-session';
import { buttonClasses } from '@/shared/ui/button';
import { Logo } from '@/shared/ui/logo';
import { ThemeToggle } from '@/shared/ui/theme-toggle';

interface NavItem {
  href: string;
  label: string;
  showUnread?: boolean;
}

const PUBLIC_NAV: NavItem[] = [
  { href: '/vehiculos', label: 'Catálogo' },
  { href: '/concesionarios', label: 'Concesionarios' },
];
// Roles unificados: cualquier usuario compra, reserva y publica desde la misma cuenta.
const PRIVATE_NAV: NavItem[] = [
  { href: '/mensajes', label: 'Mensajes', showUnread: true },
  { href: '/cuenta/reservas', label: 'Reservas' },
  { href: '/cuenta/anuncios', label: 'Mis anuncios' },
];

export function AppHeader() {
  const session = useSession();
  const pathname = usePathname();
  const unread = useUnreadCount();
  const nav =
    session.status === 'authenticated'
      ? [
          ...PUBLIC_NAV,
          ...(session.user.accountType === 'DEALER' ? [{ href: '/concesionario', label: 'Mi panel' }] : []),
          ...PRIVATE_NAV,
          ...(['ADMIN', 'ADMIN_ONE', 'SUPERVISOR'].includes(session.user.role) ? [{ href: '/admin', label: 'Admin' }] : []),
        ]
      : PUBLIC_NAV;

  // Navegación en píldoras, como en los diseños: la activa con fondo gris claro.
  const links = (className: string) =>
    nav.map(item => {
      const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
      return (
        <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={cn(className, active ? 'bg-canvas font-bold text-ink' : 'font-semibold text-muted hover:text-ink')}>
          {item.label}
          {item.showUnread && unread > 0 && (
            <span className="ml-1.5 inline-grid min-w-5 place-items-center rounded-full bg-brand px-1 font-mono text-[11px] leading-5 font-medium text-on-brand" aria-label={`${unread} conversaciones sin leer`}>
              {unread}
            </span>
          )}
        </Link>
      );
    });

  return (
    <header data-app-header className="sticky top-0 z-30 border-b border-line bg-surface">
      <ChatConnection />
      <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-5 py-3.5 sm:gap-5 sm:px-[clamp(20px,3vw,40px)]">
        <Logo href="/" />
        <SmartSearchBar className="hidden md:block" />
        <nav aria-label="Principal" className="hidden items-center gap-1 2xl:flex">
          {links('inline-flex h-10 items-center rounded-full px-3.5 text-sm whitespace-nowrap transition-colors')}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/buscar" aria-label="Buscar" className="grid size-11 place-items-center rounded-full border border-edge text-ink md:hidden">
            <Search className="size-[18px]" strokeWidth={2.2} />
          </Link>
          {/* Sin sesión, en el teléfono no cabe junto a «Entrar» y «Crear cuenta» (sigue en la pantalla de Entrar). */}
          <div className={session.status === 'anonymous' ? 'max-sm:hidden' : 'contents'}>
            <ThemeToggle />
          </div>
          {session.status === 'loading' && <span className="h-11 w-28 animate-pulse rounded-full bg-sunken" aria-hidden />}
          {session.status === 'anonymous' && (
            <>
              {/* En el teléfono solo cabe un botón: «Entrar» (la pantalla de entrar tiene la pestaña «Crear cuenta»). */}
              <Link href={`/login?next=${encodeURIComponent(pathname)}`} className={cn(buttonClasses({ size: 'md' }), 'sm:hidden')}>
                Entrar
              </Link>
              <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="px-3 text-sm leading-[44px] font-bold text-ink hover:underline max-sm:hidden">
                Entrar
              </Link>
              <Link href={`/registro?next=${encodeURIComponent(pathname)}`} className={cn(buttonClasses({ size: 'md' }), 'max-sm:hidden')}>
                Crear cuenta
              </Link>
            </>
          )}
          {session.status === 'authenticated' && (
            <>
              <NotificationBell />
              <Link href="/cuenta/anuncios/nuevo" className="px-3 text-sm leading-[44px] font-bold whitespace-nowrap text-ink hover:underline max-sm:hidden">
                Publica tu auto
              </Link>
              <UserMenu user={session.user} />
            </>
          )}
        </div>
      </div>
      {nav.length > 1 && (
        <div className="border-t border-line 2xl:hidden">
          <nav aria-label="Principal (móvil)" className="scrollbar-none mx-auto flex max-w-[1320px] gap-1 overflow-x-auto px-4 py-2 sm:px-[clamp(20px,3vw,40px)]">
            {links('inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-sm transition-colors')}
          </nav>
        </div>
      )}
      <ExpiryBanner />
    </header>
  );
}
