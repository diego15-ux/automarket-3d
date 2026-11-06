'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/shared/lib/cn';
import { useSession } from '@/shared/lib/use-session';

const ITEMS = [
  { href: '/admin', label: 'Resumen' },
  { href: '/admin/pagos', label: 'Pagos Binance' },
  { href: '/admin/usuarios', label: 'Usuarios y membresías' },
  { href: '/admin/comisiones', label: 'Comisiones' },
  { href: '/admin/planes', label: 'Planes y ajustes' },
  { href: '/admin/sitio', label: 'Portada, login y Términos' },
  { href: '/admin/inventario', label: 'Inventario' },
  { href: '/admin/carrusel', label: 'Carrusel' },
  { href: '/admin/moderacion', label: 'Moderación' },
  { href: '/admin/kyc', label: 'KYC' },
];

/** Sub-navegación del panel: pestañas de texto con la activa subrayada en tinta. */
export function AdminNav() {
  const pathname = usePathname();
  const session = useSession();
  const items = session.status === 'authenticated' && session.user.role === 'SUPERVISOR'
    ? ITEMS.filter(item => item.href === '/admin/moderacion' || item.href === '/admin/kyc')
    : ITEMS;
  return (
    <nav aria-label="Administración" className="scrollbar-none -mx-4 mb-8 flex gap-6 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      {items.map(item => {
        const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn('-mb-px shrink-0 border-b-2 py-2.5 text-sm whitespace-nowrap transition-colors', active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
