'use client';

import type { Role } from '@automarket/contracts';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, BarChart3, CarFront, Coins, ExternalLink, Flag, Images, LayoutDashboard, LogOut, Menu, MessageSquareQuote, MessagesSquare, ScrollText, SlidersHorizontal, Star, Users, Wallet, X, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { authApi } from '@/features/auth/api';
import { kycApi } from '@/features/kyc/api';
import { cn } from '@/shared/lib/cn';
import { initials } from '@/shared/lib/format';
import { api } from '@/shared/lib/http';
import { useSession } from '@/shared/lib/use-session';
import { Logo } from '@/shared/ui/logo';
import { ThemeToggle } from '@/shared/ui/theme-toggle';

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: 'payments' | 'kyc' | 'reports';
  roles?: Role[];
}

const STAFF: Role[] = ['ADMIN', 'ADMIN_ONE', 'SUPERVISOR'];
/** Menú del panel de los diseños, con las secciones reales de la plataforma. */
const GROUPS: Array<{ head: string; items: Item[] }> = [
  {
    head: 'General',
    items: [
      { href: '/admin', label: 'Resumen', icon: LayoutDashboard },
      { href: '/admin/estadisticas', label: 'Estadísticas', icon: BarChart3 },
      { href: '/admin/copiloto', label: 'Copiloto del admin', icon: MessagesSquare },
      { href: '/admin/pagos', label: 'Pagos Binance', icon: Wallet, badge: 'payments' },
      { href: '/admin/comisiones', label: 'Comisiones', icon: Coins },
    ],
  },
  {
    head: 'Personas',
    items: [
      { href: '/admin/usuarios', label: 'Usuarios y membresías', icon: Users },
      { href: '/admin/kyc', label: 'Verificación KYC', icon: BadgeCheck, badge: 'kyc', roles: STAFF },
      { href: '/admin/reportes', label: 'Reportes', icon: Flag, badge: 'reports', roles: STAFF },
    ],
  },
  {
    head: 'Contenido',
    items: [
      { href: '/admin/inventario', label: 'Inventario', icon: CarFront },
      { href: '/admin/carrusel', label: 'Carrusel de portada', icon: Images },
      { href: '/admin/pantalla-entrada', label: 'Pantalla de entrada', icon: Star },
      { href: '/admin/moderacion', label: 'Opiniones y contacto', icon: MessageSquareQuote, roles: STAFF },
    ],
  },
  {
    head: 'Ajustes',
    items: [
      { href: '/admin/planes', label: 'Planes y ajustes', icon: SlidersHorizontal },
      { href: '/admin/sitio', label: 'Portada, login y Términos', icon: ScrollText },
    ],
  },
];

const ROLE_LABELS: Record<Role, string> = { ADMIN_ONE: 'Administrador principal', ADMIN: 'Administrador', SUPERVISOR: 'Supervisor', USER: 'Usuario' };

function useBadges(role: Role | null) {
  const admin = role === 'ADMIN' || role === 'ADMIN_ONE';
  const staff = role !== null && STAFF.includes(role);
  const payments = useQuery({ queryKey: ['admin', 'badge', 'payments'], queryFn: () => api.get<{ review: number }>('/api/admin/payments/counts'), enabled: admin, refetchInterval: 60_000 });
  const reports = useQuery({ queryKey: ['admin', 'badge', 'reports'], queryFn: () => api.get<{ counts: { OPEN: number } }>('/api/admin/reports/board?light=1'), enabled: staff, refetchInterval: 60_000 });
  const kyc = useQuery({ queryKey: ['admin', 'badge', 'kyc'], queryFn: kycApi.counts, enabled: staff, refetchInterval: 60_000 });
  const label = (n: number | undefined) => (n ? String(n) : null);
  return {
    payments: label(payments.data?.review),
    reports: label(reports.data?.counts.OPEN),
    kyc: label(kyc.data?.PENDING),
  };
}

function Nav({ role, onNavigate }: { role: Role | null; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const badges = useBadges(role);
  const visible = (item: Item) => (role === 'SUPERVISOR' ? Boolean(item.roles?.includes('SUPERVISOR')) : true);

  async function logout() {
    await authApi.logout();
    router.push('/login');
  }

  return (
    <>
      <nav aria-label="Secciones del panel" className="flex flex-col gap-0.5">
        {GROUPS.map(group => {
          const items = group.items.filter(visible);
          if (items.length === 0) return null;
          return (
            <div key={group.head} className="flex flex-col gap-0.5">
              <p className="mt-3.5 mb-1.5 px-3 font-mono text-[11px] text-[#7d838d]">{group.head}</p>
              {items.map(item => {
                const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
                const badge = item.badge ? badges[item.badge] : null;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn('flex h-11 items-center gap-3 rounded-[12px] px-3 text-sm transition-colors', active ? 'bg-[#1c201e] font-bold text-white' : 'text-[#c7cbd1] hover:bg-[#16181b] hover:text-white')}
                  >
                    <Icon className={cn('size-[19px]', active ? 'text-mint' : 'text-[#a2a7b0]')} strokeWidth={1.8} aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    {badge && <span className="inline-grid h-[22px] min-w-[22px] place-items-center rounded-full bg-brand px-1.5 font-mono text-[11px] font-medium text-on-brand">{badge}</span>}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-night-line pt-4">
        <Link href="/" onClick={onNavigate} className="flex h-11 items-center gap-3 rounded-[12px] px-3 text-sm text-[#a2a7b0] hover:bg-[#16181b] hover:text-white">
          <ExternalLink className="size-[19px]" strokeWidth={1.8} aria-hidden />
          Ver el sitio
        </Link>
        <button type="button" onClick={logout} className="flex h-11 items-center gap-3 rounded-[12px] px-3 text-left text-sm text-[#a2a7b0] hover:bg-[#16181b] hover:text-white">
          <LogOut className="size-[19px]" strokeWidth={1.8} aria-hidden />
          Cerrar sesión
        </button>
      </div>
    </>
  );
}

function Profile({ name, role }: { name: string; role: Role | null }) {
  return (
    <div className="flex flex-col items-center rounded-[20px] border border-night-line bg-night-2 px-3 py-[18px] text-center">
      <span className="grid size-[68px] place-items-center rounded-full bg-[#202328] text-[22px] font-extrabold shadow-[0_0_0_3px_#0e0f11,0_0_0_5px_#c8102e]">{initials(name)}</span>
      <p className="mt-3 text-base font-bold">{name}</p>
      <p className="mt-0.5 text-[13px] text-[#a2a7b0]">{role ? ROLE_LABELS[role] : ''}</p>
    </div>
  );
}

/**
 * Marco del panel de los diseños: menú lateral negro con el perfil y contadores reales
 * (pagos por verificar, KYC pendientes, reportes abiertos). En el teléfono, el menú se abre
 * como cajón desde el botón de la esquina.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const user = session.status === 'authenticated' ? session.user : null;
  const role = user?.role ?? null;
  const current = GROUPS.flatMap(group => group.items).find(item => (item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href)));

  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  const sidebar = (onNavigate?: () => void) => (
    <>
      <div className="flex items-center gap-2.5 px-2">
        <Logo href="/admin" tone="night" />
        {!onNavigate && <span className="ml-auto inline-flex h-[22px] items-center rounded-full border border-[#2e3238] px-2 font-mono text-[10.5px] text-[#a2a7b0]">Admin</span>}
      </div>
      {user && <Profile name={user.name} role={role} />}
      <Nav role={role} onNavigate={onNavigate} />
    </>
  );

  return (
    <div className="flex min-h-dvh bg-canvas text-ink print:bg-white">
      <aside aria-label="Menú del panel" className="sticky top-0 hidden h-dvh print:hidden! w-[264px] shrink-0 flex-col gap-[22px] overflow-y-auto bg-night px-3.5 pt-[22px] pb-6 text-[#f2f3f5] lg:flex">
        {sidebar()}
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú del panel">
          <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-black/55" onClick={() => setDrawer(false)} />
          <div className="relative flex h-full w-[min(300px,86vw)] flex-col gap-[22px] overflow-y-auto bg-night px-3.5 pt-[22px] pb-6 text-[#f2f3f5]">
            <button type="button" aria-label="Cerrar menú" onClick={() => setDrawer(false)} className="absolute top-4 right-3 grid size-10 place-items-center rounded-full border border-[#2e3238] text-[#f2f3f5]">
              <X className="size-4" />
            </button>
            {sidebar(() => setDrawer(false))}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-5 pt-5 lg:hidden print:hidden!">
          <button type="button" aria-label="Abrir menú del panel" aria-expanded={drawer} onClick={() => setDrawer(true)} className="grid size-11 place-items-center rounded-full border border-line bg-surface text-ink">
            <Menu className="size-[19px]" strokeWidth={2} />
          </button>
          <div className="min-w-0 flex-1 pl-1">
            <p className="font-mono text-[11px] text-faint">Panel · Admin</p>
            <p className="truncate text-[22px] font-semibold tracking-[-0.03em]">{current?.label ?? 'Panel'}</p>
          </div>
          <ThemeToggle />
        </div>
        {/* Como en los diseños: sin antetítulo «Administración»; en el teléfono el título va en la barra de arriba. */}
        <main className="min-w-0 flex-1 px-5 pt-[26px] pb-[110px] print:p-0 sm:px-[clamp(16px,2.4vw,32px)] [&_[data-page-eyebrow]]:hidden max-lg:[&_[data-page-title]]:hidden">
          <div className="mx-auto max-w-[1180px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

