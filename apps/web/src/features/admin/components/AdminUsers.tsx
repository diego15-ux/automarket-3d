'use client';

import { BILLING_CYCLES, CYCLE_LABELS, PLAN_CODES, PLAN_LABELS, countryName, type BillingCycle, type PlanCode } from '@automarket/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ConfirmButton } from '@/features/reservations/components/ConfirmButton';
import { formatDate } from '@/shared/lib/format';
import { useSession } from '@/shared/lib/use-session';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Input, Select } from '@/shared/ui/field';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { adminApi, adminKeys, type AdminUser } from '../api';

/** Alta / renovación / baja manual de membresía (pagos fuera de la plataforma, cortesías…). */
function MembershipForm({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const toast = useToast();
  const [planCode, setPlanCode] = useState<PlanCode>(user.plan.code === 'FREE' ? (user.accountType === 'DEALER' ? 'DEALER_BASIC' : 'PREMIUM') : user.plan.code);
  const [cycle, setCycle] = useState<BillingCycle>('MONTHLY');
  const [periods, setPeriods] = useState(1);
  const [note, setNote] = useState('');
  const grant = useMutation({
    mutationFn: () => adminApi.grantMembership(user.id, { planCode, cycle, periods, note: note || undefined }),
    onSuccess: () => {
      toast({ tone: 'success', title: planCode === 'FREE' ? 'Usuario pasado al plan Gratis' : `Plan ${PLAN_LABELS[planCode]} aplicado`, description: user.email });
      onDone();
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo aplicar', description: err.message }),
  });

  return (
    <form
      className="mt-3 grid gap-2 rounded-md border border-line bg-sunken p-3 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        grant.mutate();
      }}
    >
      <Select aria-label="Plan" value={planCode} onChange={event => setPlanCode(event.target.value as PlanCode)} className="h-9 text-xs">
        {PLAN_CODES.map(code => (
          <option key={code} value={code}>
            {PLAN_LABELS[code]}
          </option>
        ))}
      </Select>
      <Select aria-label="Ciclo" value={cycle} disabled={planCode === 'FREE'} onChange={event => setCycle(event.target.value as BillingCycle)} className="h-9 text-xs">
        {BILLING_CYCLES.map(value => (
          <option key={value} value={value}>
            {CYCLE_LABELS[value]}
          </option>
        ))}
      </Select>
      <Input aria-label="Periodos" type="number" min={1} max={24} value={periods} disabled={planCode === 'FREE'} onChange={event => setPeriods(Math.max(1, Number(event.target.value)))} className="h-9 text-xs" />
      <Input aria-label="Nota" placeholder="Nota (opcional)" value={note} onChange={event => setNote(event.target.value)} className="h-9 text-xs" />
      <Button type="submit" size="sm" loading={grant.isPending}>
        Aplicar
      </Button>
      <p className="text-[11px] text-muted sm:col-span-5">Renovar el mismo plan acumula sobre el vencimiento actual; otro plan empieza hoy. Queda registrado en el historial y la auditoría.</p>
    </form>
  );
}

export function AdminUsers() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const session = useSession();
  const isOwner = session.status === 'authenticated' && session.user.role === 'ADMIN_ONE';
  const [filters, setFilters] = useState<{ q?: string; plan?: string; status?: string; page: number }>({ page: 1 });
  const [editing, setEditing] = useState<string | null>(null);
  // Búsqueda que llega del buscador del Resumen (/admin/usuarios?q=…).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setFilters(f => ({ ...f, q, page: 1 }));
  }, []);
  const users = useQuery({ queryKey: adminKeys.users(filters), queryFn: () => adminApi.users(filters), placeholderData: keepPreviousData });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'SUSPENDED' }) => adminApi.setUserStatus(id, status),
    onSuccess: () => void refresh(),
    onError: err => toast({ tone: 'error', title: 'No se pudo cambiar el estado', description: err.message }),
  });
  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'USER' | 'ADMIN' | 'SUPERVISOR' }) => adminApi.setUserRole(id, role),
    onSuccess: () => void refresh(),
    onError: err => toast({ tone: 'error', title: 'No se pudo cambiar el rol', description: err.message }),
  });

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={event => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setFilters({ q: String(data.get('q') ?? ''), plan: String(data.get('plan') ?? ''), status: String(data.get('status') ?? ''), page: 1 });
        }}
      >
        <div className="relative min-w-60 flex-1">
          <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <Input key={filters.q ?? ''} name="q" placeholder="Nombre o email" className="pl-10" defaultValue={filters.q} />
        </div>
        <Select name="plan" defaultValue={filters.plan ?? ''} className="w-auto" aria-label="Plan">
          <option value="">Todos los planes</option>
          {PLAN_CODES.map(code => (
            <option key={code} value={code}>
              {PLAN_LABELS[code]}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={filters.status ?? ''} className="w-auto" aria-label="Estado">
          <option value="">Todos</option>
          <option value="ACTIVE">Activos</option>
          <option value="SUSPENDED">Suspendidos</option>
        </Select>
        <Button type="submit">Filtrar</Button>
      </form>

      {users.isPending ? (
        <PageSpinner />
      ) : users.isError ? (
        <p className="text-danger-fg">{users.error.message}</p>
      ) : (
        <>
          <p className="text-sm text-muted">{users.data.total} usuarios</p>
          <ul className="space-y-2">
            {users.data.items.map(user => (
              <li key={user.id} className="rounded-md border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-semibold">
                      {user.name} {user.isVerified && <BadgeCheck className="size-4 text-success-fg" aria-label="Verificado" />}
                      {user.role === 'ADMIN_ONE' && <Badge tone="brand">Admin One</Badge>}
                      {user.role === 'ADMIN' && <Badge tone="neutral">Admin</Badge>}
                      {user.role === 'SUPERVISOR' && <Badge tone="gold">Supervisor</Badge>}
                      {user.accountType === 'DEALER' && <Badge tone="gold">Concesionario{user.businessName ? ` · ${user.businessName}` : ''}{user.taxId ? ` · RIF ${user.taxId}` : ''}</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {user.email} · {user.city ? `${user.city}, ${countryName(user.country)}` : 'sin ubicación'} · alta {formatDate(user.createdAt)} · {user.vehicles} anuncios
                    </p>
                  </div>
                  <Badge tone={user.plan.code === 'FREE' ? 'neutral' : 'gold'}>
                    {PLAN_LABELS[user.plan.code]}
                    {user.plan.expiresAt && ` · vence ${formatDate(user.plan.expiresAt)}`}
                  </Badge>
                  <Badge tone={user.status === 'ACTIVE' ? 'success' : 'danger'}>{user.status === 'ACTIVE' ? 'Activo' : 'Suspendido'}</Badge>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(editing === user.id ? null : user.id)}>
                      Membresía
                    </Button>
                    {(user.role === 'USER' || (isOwner && user.role !== 'ADMIN_ONE')) && session.status === 'authenticated' && user.id !== session.user.id && (
                      <ConfirmButton size="sm" variant={user.status === 'ACTIVE' ? 'danger' : 'outline'} onConfirm={() => setStatus.mutate({ id: user.id, status: user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })}>
                        {user.status === 'ACTIVE' ? 'Suspender' : 'Reactivar'}
                      </ConfirmButton>
                    )}
                    {isOwner && user.id !== session.user.id && user.role !== 'ADMIN_ONE' && (
                      <RoleControl key={`${user.id}-${user.role}`} user={user} onSave={role => setRole.mutate({ id: user.id, role })} loading={setRole.isPending} />
                    )}
                  </div>
                </div>
                {editing === user.id && (
                  <MembershipForm
                    user={user}
                    onDone={() => {
                      setEditing(null);
                      void refresh();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
          {users.data.total > users.data.pageSize && (
            <div className="flex items-center justify-center gap-2">
              <Button size="sm" variant="outline" disabled={filters.page <= 1} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
                Anterior
              </Button>
              <span className="text-sm text-muted">Página {filters.page}</span>
              <Button size="sm" variant="outline" disabled={filters.page * users.data.pageSize >= users.data.total} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>
                Siguiente
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RoleControl({ user, onSave, loading }: { user: AdminUser; onSave: (role: 'USER' | 'ADMIN' | 'SUPERVISOR') => void; loading: boolean }) {
  const [role, setRole] = useState<'USER' | 'ADMIN' | 'SUPERVISOR'>(user.role === 'ADMIN_ONE' ? 'USER' : user.role);
  return (
    <div className="flex items-center gap-2">
      <Select aria-label={`Rol para ${user.email}`} value={role} onChange={event => setRole(event.target.value as typeof role)} className="h-9 text-xs">
        <option value="USER">Usuario</option>
        <option value="ADMIN">Administrador</option>
        <option value="SUPERVISOR">Supervisor</option>
      </Select>
      {role !== user.role && (
        <ConfirmButton size="sm" variant="outline" loading={loading} onConfirm={() => onSave(role)} confirmLabel="¿Cambiar rol?">
          Guardar rol
        </ConfirmButton>
      )}
    </div>
  );
}
