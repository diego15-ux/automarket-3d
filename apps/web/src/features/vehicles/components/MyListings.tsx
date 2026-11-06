'use client';

import { PLAN_LABELS, VEHICLE_STATUS_LABELS, type PaymentMethod, type PlanCode, type VehicleStatus } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CarFront, Megaphone, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { boostKeys, boostsApi } from '@/features/boosts/api';
import { CommissionCheckoutDialog } from '@/features/payments/components/CommissionCheckoutDialog';
import { ConfirmButton } from '@/features/reservations/components/ConfirmButton';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { Badge } from '@/shared/ui/badge';
import { Button, buttonClasses } from '@/shared/ui/button';
import { Card, EmptyState } from '@/shared/ui/card';
import { MediaImage } from '@/shared/ui/media-image';
import { PageSpinner } from '@/shared/ui/spinner';
import { useToast } from '@/shared/ui/toaster';
import { vehicleKeys, vehiclesApi, type MyListing } from '../api';

const TONE: Partial<Record<VehicleStatus, 'success' | 'gold' | 'brand' | 'danger'>> = { PUBLISHED: 'success', RESERVED: 'brand', PENDING_SALE: 'gold', PAUSED: 'gold', EXPIRED: 'danger', SOLD: 'brand' };
type Action = 'publish' | 'pause' | 'feature' | 'unfeature' | 'archive';

/** Mis anuncios: uso del plan, estados y acciones (publicar, pausar, renovar, destacar, retirar). */
export function MyListings() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [saleListing, setSaleListing] = useState<MyListing | null>(null);
  const mine = useQuery({ queryKey: vehicleKeys.mine, queryFn: vehiclesApi.mine });
  // Pagos de «Destacar» que el equipo aún no confirma: el anuncio no está destacado todavía.
  const boosts = useQuery({ queryKey: boostKeys.options, queryFn: boostsApi.options });
  const inReview = new Set(boosts.data?.listings.filter(listing => listing.pendingReview).map(listing => listing.id));
  const act = useMutation({
    mutationFn: async ({ action, id }: { action: Action; id: string }) => {
      await vehiclesApi[action](id);
    },
    onSuccess: (_result, { action }) => {
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      const labels: Record<Action, string> = { publish: 'Anuncio publicado', pause: 'Anuncio en pausa', feature: 'Anuncio destacado', unfeature: 'Destacado retirado', archive: 'Anuncio retirado' };
      toast({ tone: 'success', title: labels[action] });
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo completar', description: err.message }),
  });
  const markSold = useMutation({
    mutationFn: ({ vehicleId, salePrice, method }: { vehicleId: string; salePrice: string; method?: PaymentMethod }) =>
      vehiclesApi.markSold(vehicleId, { salePrice, ...(method ? { method } : {}) }),
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      setSaleListing(null);
      if (result.payment) {
        router.push(`/pagos/${result.payment.id}`);
      } else {
        toast({ tone: 'success', title: 'Venta finalizada', description: 'Este plan no cobra comisión.' });
      }
    },
    onError: err => toast({ tone: 'error', title: 'No se pudo registrar la venta', description: err.message }),
  });

  if (mine.isPending) return <PageSpinner />;
  if (mine.isError) return <EmptyState title="No pudimos cargar tus anuncios" description={mine.error.message} />;
  const { items, usage } = mine.data;
  const canFeature = usage.featuredSlots > 0;
  const full = usage.max !== null && usage.slotsUsed >= usage.max;
  const month = new Date().toISOString().slice(0, 7);
  const busy = (id: string) => act.isPending && act.variables?.id === id;

  const actions = (v: MyListing) => {
    const list: React.ReactNode[] = [];
    if (['DRAFT', 'PAUSED', 'EXPIRED'].includes(v.status)) {
      list.push(
        <Button key="publish" size="sm" loading={busy(v.id)} onClick={() => act.mutate({ action: 'publish', id: v.id })} disabled={v.mediaCount === 0}>
          {v.status === 'DRAFT' ? 'Publicar' : v.status === 'PAUSED' ? 'Reanudar' : 'Renovar'}
        </Button>,
      );
    }
    if (v.status === 'PUBLISHED') {
      list.push(
        <Button key="pause" size="sm" variant="outline" loading={busy(v.id)} onClick={() => act.mutate({ action: 'pause', id: v.id })}>
          Pausar
        </Button>,
      );
      if (canFeature) {
        list.push(
          v.isFeatured ? (
            <Button key="unfeature" size="sm" variant="ghost" onClick={() => act.mutate({ action: 'unfeature', id: v.id })}>
              Quitar destacado
            </Button>
          ) : (
            <Button key="feature" size="sm" variant="outline" onClick={() => act.mutate({ action: 'feature', id: v.id })}>
              <Megaphone className="size-3.5" /> Destacar con mi plan
            </Button>
          ),
        );
      }
      // Impulsos pagados (zona, Portada o pantalla de entrada) con Binance.
      list.push(
        <Link key="boost" href={`/destacar?anuncio=${v.id}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          <Megaphone className="size-3.5" /> {canFeature ? 'Impulso pagado' : 'Destacar'}
        </Link>,
      );
    }
    if (['PUBLISHED', 'PAUSED', 'EXPIRED'].includes(v.status)) {
      list.push(
        <Button key="sold" size="sm" variant="outline" onClick={() => setSaleListing(v)}>
          Marcar vendido
        </Button>,
      );
    }
    if (v.status === 'PENDING_SALE' && v.pendingSalePaymentId) {
      list.push(
        <Link key="sale-payment" href={`/pagos/${v.pendingSalePaymentId}`} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          Ver pago pendiente
        </Link>,
      );
    }
    if (v.status !== 'RESERVED' && v.status !== 'SOLD' && v.status !== 'PENDING_SALE') {
      list.push(
        <ConfirmButton key="archive" size="sm" variant="danger" confirmLabel="¿Retirar definitivamente?" onConfirm={() => act.mutate({ action: 'archive', id: v.id })}>
          Retirar
        </ConfirmButton>,
      );
    }
    return list;
  };

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <div className="flex-1">
          <p className="text-sm text-muted">
            Plan <strong className="text-ink">{PLAN_LABELS[usage.planCode as PlanCode]}</strong> · anuncios en tu cupo (borradores incluidos)
          </p>
          <p className="mt-1 font-display text-2xl">
            {usage.slotsUsed} / {usage.max ?? '∞'}
          </p>
          {usage.max !== null && (
            <div className="mt-2 h-2 max-w-sm overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (usage.slotsUsed / usage.max) * 100)}%` }} />
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            {usage.active === 1 ? '1 publicado ahora.' : `${usage.active} publicados ahora.`}
            {usage.planCode === 'FREE' && ' Con el plan Gratis publicas 1 anuncio sin pagar.'}
          </p>
          {usage.monthlyFeaturedCredits > 0 && <p className="mt-2 text-xs text-muted">Destacado mensual: {usage.featureCreditMonth === month ? 'usado este mes' : 'disponible'}.</p>}
        </div>
        <div className="flex gap-2">
          {full ? (
            <Link href="/cuenta/plan" className={buttonClasses({ variant: 'gold', size: 'sm' })}>
              Mejorar plan para publicar más
            </Link>
          ) : (
            <Link href="/cuenta/anuncios/nuevo" className={buttonClasses({ size: 'sm' })}>
              <Plus className="size-4" /> Nuevo anuncio
            </Link>
          )}
        </div>
      </Card>

      {items.length === 0 ? (
        <EmptyState icon={<CarFront className="size-6" />} title="Aún no has publicado ningún vehículo" description="Crea tu primer anuncio en minutos: ficha técnica, precio y galería de hasta 10 fotos o vídeos." />
      ) : (
        <ul className="space-y-3">
          {items.map((v, index) => (
            <li key={v.id} className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4 sm:flex-row sm:items-center">
              <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-md bg-sunken sm:w-40">
                {v.coverUrl ? <MediaImage src={v.coverUrl} alt="" fill priority={index < 3} sizes="160px" className="object-cover" /> : <span className="grid h-full place-items-center text-xs text-muted">Sin foto</span>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-display text-lg">
                    {v.make} {v.model} {v.year}
                  </p>
                  <Badge tone={TONE[v.status] ?? 'neutral'}>{VEHICLE_STATUS_LABELS[v.status]}</Badge>
                  {v.isFeatured && <Badge tone="gold">Destacado</Badge>}
                  {inReview.has(v.id) && <Badge tone="gold">Pago de Destacar en revisión</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted">
                  {formatMoney(v.price, v.currency)} · {v.city} · {v.mediaCount === 1 ? '1 foto o vídeo' : `${v.mediaCount} fotos o vídeos`}
                  {v.status === 'PUBLISHED' && <> · {v.expiresAt ? `vence el ${formatDate(v.expiresAt)}` : 'sin vencimiento'}</>}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/cuenta/anuncios/${v.id}`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                    <Pencil className="size-3.5" /> Editar
                  </Link>
                  {actions(v)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <CommissionCheckoutDialog
        open={saleListing !== null}
        onClose={() => setSaleListing(null)}
        vehicleTitle={saleListing ? `${saleListing.make} ${saleListing.model} ${saleListing.year}` : ''}
        initialPrice={saleListing?.price ?? ''}
        currency={saleListing?.currency ?? 'USD'}
        commissionRate={usage.commissionRate}
        loading={markSold.isPending}
        onSubmit={input => saleListing && markSold.mutate({ vehicleId: saleListing.id, ...input })}
      />
    </div>
  );
}
