'use client';

import { PLAN_LABELS } from '@automarket/contracts';
import { BadgeCheck, BellRing, CalendarCheck, CarFront, Crown, LayoutDashboard, LogOut, MessageCircle, Plus, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { SessionUser } from '@/shared/lib/session';
import { Avatar } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { authApi } from '../api';


export function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  // Cerrar al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function logout() {
    setOpen(false);
    await authApi.logout();
    router.push('/login');
  }

  const item = 'flex items-center gap-3 rounded-sm px-3 py-2 text-sm text-ink hover:bg-ink/[0.05]';

  return (
    <div ref={container} className="relative">
      <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="menu" aria-label={`Menú de ${user.name}`} className="flex items-center gap-2 rounded-full text-sm font-bold hover:ring-2 hover:ring-edge">
        <Avatar name={user.name} src={user.avatarUrl} className="size-11" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-72 rounded-md border border-line bg-surface p-1.5 shadow-pop">
          <div className="border-b border-line px-3 pt-2.5 pb-3">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={user.plan.code === 'FREE' ? 'neutral' : 'gold'}>Plan {PLAN_LABELS[user.plan.code]}</Badge>
              {user.role === 'ADMIN_ONE' && <Badge tone="brand">Admin One</Badge>}
              {user.role === 'ADMIN' && <Badge tone="neutral">Administrador</Badge>}
              {user.role === 'SUPERVISOR' && <Badge tone="gold">Supervisor</Badge>}
              {user.isVerified && (
                <Badge tone="brand">
                  <BadgeCheck className="size-3.5" /> Verificado
                </Badge>
              )}
            </div>
          </div>
          <nav className="pt-1.5" onClick={() => setOpen(false)}>
            <Link href="/cuenta/anuncios/nuevo" className={item} role="menuitem">
              <Plus className="size-4 text-muted" /> Publicar un vehículo
            </Link>
            <Link href="/cuenta/anuncios" className={item} role="menuitem">
              <CarFront className="size-4 text-muted" /> Mis anuncios
            </Link>
            <Link href="/mensajes" className={item} role="menuitem">
              <MessageCircle className="size-4 text-muted" /> Mensajes
            </Link>
            <Link href="/cuenta/reservas" className={item} role="menuitem">
              <CalendarCheck className="size-4 text-muted" /> Mis reservas
            </Link>
            <Link href="/alertas" className={item} role="menuitem">
              <BellRing className="size-4 text-muted" /> Mis alertas
            </Link>
            <Link href="/cuenta/plan" className={item} role="menuitem">
              <Crown className="size-4 text-muted" /> Mi membresía
            </Link>
            <Link href="/cuenta/perfil" className={item} role="menuitem">
              <UserRound className="size-4 text-muted" /> Perfil
            </Link>
            <Link href="/cuenta/verificacion" className={item} role="menuitem">
              <BadgeCheck className="size-4 text-muted" /> Verificación de identidad
            </Link>
            {['ADMIN', 'ADMIN_ONE', 'SUPERVISOR'].includes(user.role) && (
              <Link href="/admin" className={item} role="menuitem">
                <LayoutDashboard className="size-4 text-muted" /> Panel de administración
              </Link>
            )}
          </nav>
          <button type="button" onClick={logout} className={`${item} mt-1.5 w-full text-left text-danger-fg`} role="menuitem">
            <LogOut className="size-4" /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
