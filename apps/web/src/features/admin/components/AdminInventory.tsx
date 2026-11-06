'use client';

import { VEHICLE_STATUSES, VEHICLE_STATUS_LABELS } from '@automarket/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Flag, GalleryHorizontalEnd, Search, TrendingUp, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmButton } from '@/features/reservations/components/ConfirmButton';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input, Select } from '@/shared/ui/field';
import { MediaImage } from '@/shared/ui/media-image';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { adminApi, adminKeys } from '../api';

/** Inventario completo con filtros, retirada de anuncios y alta en el carrusel. */
export function AdminInventory() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filters, setFilters] = useState<{ q?: string; status?: string; page: number }>({ page: 1 });
  const inventory = useQuery({ queryKey: adminKeys.inventory(filters), queryFn: () => adminApi.inventory(filters), placeholderData: keepPreviousData });
  const carousel = useQuery({ queryKey: adminKeys.carousel, queryFn: adminApi.carousel });
  const archive = useMutation({
    mutationFn: (id: string) => adminApi.archiveVehicle(id, 'Retirado por moderación'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      toast({ tone: 'success', title: 'Anuncio retirado' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo retirar', description: err.message }),
  });
  const addToCarousel = useMutation({
    mutationFn: (vehicleId: string) => adminApi.saveCarousel([...(carousel.data?.curated ?? []).map(item => ({ vehicleId: item.vehicle.id, isActive: item.isActive })), { vehicleId, isActive: true }]),
    onSuccess: data => {
      queryClient.setQueryData(adminKeys.carousel, data);
      toast({ tone: 'success', title: 'Añadido al carrusel' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo añadir', description: err.message }),
  });
  const inCarousel = new Set(carousel.data?.curated.map(item => item.vehicle.id));

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={event => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setFilters({ q: String(data.get('q') ?? ''), status: String(data.get('status') ?? ''), page: 1 });
        }}
      >
        <div className="relative min-w-60 flex-1">
          <Search className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <Input name="q" placeholder="Marca, modelo o slug" className="pl-10" />
        </div>
        <Select name="status" className="w-auto" aria-label="Estado">
          <option value="">Activos (no retirados)</option>
          {VEHICLE_STATUSES.map(status => (
            <option key={status} value={status}>
              {VEHICLE_STATUS_LABELS[status]} {inventory.data?.byStatus[status] !== undefined ? `(${inventory.data.byStatus[status]})` : ''}
            </option>
          ))}
        </Select>
        <Button type="submit">Filtrar</Button>
      </form>

      {inventory.isPending ? (
        <PageSpinner />
      ) : inventory.isError ? (
        <p className="text-danger-fg">{inventory.error.message}</p>
      ) : (
        <>
          <p className="text-sm text-muted">{inventory.data.total} vehículos</p>
          <ul className="space-y-2">
            {inventory.data.items.map(v => (
              <li key={v.id} className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3 sm:flex-row sm:items-center">
                <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-sm bg-sunken sm:w-28">{v.coverUrl && <MediaImage src={v.coverUrl} alt="" fill sizes="112px" className="object-cover" />}</div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <Link href={`/vehiculos/${v.slug}`} className="hover:underline">
                      {v.make} {v.model} {v.year}
                    </Link>
                    <Badge tone={v.status === 'PUBLISHED' ? 'success' : 'neutral'}>{VEHICLE_STATUS_LABELS[v.status]}</Badge>
                    {v.isFeatured && <Badge tone="gold">Destacado</Badge>}
                    {v.openReports > 0 && (
                      <Badge tone="danger">
                        <Flag className="size-3" /> {v.openReports}
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {formatMoney(v.price, v.currency)} · {v.city} · {v.sellerName} ({v.sellerEmail}) · alta {formatDate(v.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {(v.status === 'PUBLISHED' || v.status === 'RESERVED') && !inCarousel.has(v.id) && (
                    <Button size="sm" variant="outline" disabled={(carousel.data?.curated.length ?? 12) >= 12} loading={addToCarousel.isPending && addToCarousel.variables === v.id} onClick={() => addToCarousel.mutate(v.id)}>
                      <GalleryHorizontalEnd className="size-3.5" /> Al carrusel
                    </Button>
                  )}
                  {v.status !== 'ARCHIVED' && v.status !== 'RESERVED' && v.status !== 'PENDING_SALE' && (
                    <ConfirmButton size="sm" variant="danger" confirmLabel="¿Retirar?" onConfirm={() => archive.mutate(v.id)}>
                      Retirar
                    </ConfirmButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {inventory.data.total > inventory.data.pageSize && (
            <div className="flex items-center justify-center gap-2">
              <Button size="sm" variant="outline" disabled={filters.page <= 1} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
                Anterior
              </Button>
              <span className="text-sm text-muted">Página {filters.page}</span>
              <Button size="sm" variant="outline" disabled={filters.page * inventory.data.pageSize >= inventory.data.total} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>
                Siguiente
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Carrusel de la landing: selección curada + recomendaciones por demanda + destacados por plan. */
export function AdminCarousel() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const carousel = useQuery({ queryKey: adminKeys.carousel, queryFn: adminApi.carousel });
  const recommendations = useQuery({ queryKey: adminKeys.marketRecommendations, queryFn: adminApi.marketRecommendations });
  const save = useMutation({
    mutationFn: adminApi.saveCarousel,
    onSuccess: data => {
      queryClient.setQueryData(adminKeys.carousel, data);
      toast({ tone: 'success', title: 'Carrusel actualizado', description: 'La landing ya muestra el nuevo orden.' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo guardar', description: err.message }),
  });
  const items = carousel.data?.curated.map(item => ({ vehicleId: item.vehicle.id, isActive: item.isActive })) ?? [];
  const addRecommendation = useMutation({
    mutationFn: (vehicleId: string) => {
      if (items.length >= 12) throw new Error('El carrusel ya tiene 12 vehículos. Retira uno antes de agregar otro.');
      return adminApi.saveCarousel([...items, { vehicleId, isActive: true }]);
    },
    onSuccess: data => {
      queryClient.setQueryData(adminKeys.carousel, data);
      void queryClient.invalidateQueries({ queryKey: adminKeys.marketRecommendations });
      toast({ tone: 'success', title: 'Vehículo de alta demanda añadido al carrusel' });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo añadir', description: err.message }),
  });
  const move = (index: number, delta: number) => {
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved!);
    save.mutate(next);
  };

  if (carousel.isPending) return <PageSpinner />;
  if (carousel.isError) return <p className="text-danger-fg">{carousel.error.message}</p>;

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <TrendingUp className="mt-1 size-5 shrink-0 text-brand-fg" />
          <div>
            <h2 className="font-display text-lg">Autos con más interés real</h2>
            <p className="mt-1 text-xs text-muted">Ranking de los últimos 30 días: compradores únicos que contactaron y solicitaron reserva. Una reserva pesa 3 puntos. No usamos clics ni visitas.</p>
          </div>
        </div>
        {recommendations.isPending ? (
          <p className="mt-4 text-sm text-muted">Calculando oportunidades…</p>
        ) : recommendations.isError ? (
          <p className="mt-4 text-sm text-danger-fg">{recommendations.error.message}</p>
        ) : recommendations.data.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Aún no hay autos con suficiente actividad reciente para recomendar.</p>
        ) : (
          <ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {recommendations.data.map((candidate, index) => (
              <li key={candidate.vehicle.id} className="flex items-center gap-3 rounded-md border border-line p-3">
                <span className="w-6 shrink-0 text-center text-sm font-semibold text-muted">{index + 1}</span>
                <div className="relative aspect-[16/10] w-20 shrink-0 overflow-hidden rounded-sm bg-sunken">
                  {candidate.vehicle.coverUrl && <MediaImage src={candidate.vehicle.coverUrl} alt="" fill sizes="80px" className="object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{candidate.vehicle.make} {candidate.vehicle.model} {candidate.vehicle.year}</p>
                  <p className="text-xs text-muted">{candidate.contactCount} contactos · {candidate.reservationCount} reservas · {candidate.influenceScore} puntos</p>
                  <Button size="sm" variant="outline" className="mt-2" disabled={items.length >= 12 || addRecommendation.isPending} loading={addRecommendation.isPending && addRecommendation.variables === candidate.vehicle.id} onClick={() => addRecommendation.mutate(candidate.vehicle.id)}>
                    Añadir al carrusel
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
        <h2 className="font-display text-lg">Selección del equipo</h2>
        <p className="mt-1 text-xs text-muted">Aparecen primero y en este orden. Máximo 12 vehículos en el carrusel.</p>
        {carousel.data.curated.length === 0 && <p className="mt-6 text-sm text-muted">Aún no hay vehículos seleccionados.</p>}
        <ol className="mt-4 space-y-2">
          {carousel.data.curated.map((item, index) => (
            <li key={item.vehicle.id} className="flex items-center gap-3 rounded-md border border-line p-2">
              <span className="w-6 text-center text-sm font-semibold text-muted">{index + 1}</span>
              <div className="relative aspect-[16/10] w-20 shrink-0 overflow-hidden rounded-sm bg-sunken">{item.vehicle.coverUrl && <MediaImage src={item.vehicle.coverUrl} alt="" fill sizes="80px" className="object-cover" />}</div>
              <p className={`min-w-0 flex-1 truncate text-sm font-semibold ${item.isActive ? '' : 'text-muted line-through'}`}>
                {item.vehicle.make} {item.vehicle.model} {item.vehicle.year}
              </p>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" aria-label="Subir" disabled={index === 0 || save.isPending} onClick={() => move(index, -1)} className="size-8">
                  <ArrowUp className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" aria-label="Bajar" disabled={index === items.length - 1 || save.isPending} onClick={() => move(index, 1)} className="size-8">
                  <ArrowDown className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate(items.map((it, i) => (i === index ? { ...it, isActive: !it.isActive } : it)))}>
                  {item.isActive ? 'Ocultar' : 'Mostrar'}
                </Button>
                <Button size="icon" variant="ghost" aria-label="Quitar" disabled={save.isPending} onClick={() => save.mutate(items.filter((_, i) => i !== index))} className="size-8">
                  <X className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
        </Card>
        <Card className="p-5">
        <h2 className="font-display text-lg">Destacados por plan</h2>
        <p className="mt-1 text-xs text-muted">La página muestra como máximo 50 anuncios destacados para no cargar todo el inventario.</p>
        <p className="mt-1 text-xs font-medium text-muted">{carousel.data.featuredTotal} destacados activos · mostrando {carousel.data.featured.length}</p>
        <ul className="mt-4 space-y-2">
          {carousel.data.featured.length === 0 && <li className="text-sm text-muted">No hay destacados vigentes.</li>}
          {carousel.data.featured.map(vehicle => (
            <li key={vehicle.id} className="flex items-center justify-between gap-3 rounded-md border border-line p-3 text-sm">
              <span className="truncate font-semibold">
                {vehicle.make} {vehicle.model} {vehicle.year}
              </span>
              <span className="shrink-0 text-xs text-muted">{vehicle.featuredUntil ? `hasta ${formatDate(vehicle.featuredUntil)}` : ''}</span>
            </li>
          ))}
        </ul>
        </Card>
      </div>
    </div>
  );
}
