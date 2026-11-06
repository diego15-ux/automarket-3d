'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { alertKeys } from '@/features/alerts/api';
import { cn } from '@/shared/lib/cn';
import { useSession } from '@/shared/lib/use-session';
import { useToast } from '@/shared/ui/toaster';
import { vehicleKeys, vehiclesApi } from './api';

/** «Guardar» en la ficha: mis autos guardados (necesita sesión; sin ella lleva a Entrar). */
export function useSaved() {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const toast = useToast();
  const signedIn = session.status === 'authenticated';
  const list = useQuery({ queryKey: vehicleKeys.savedIds, queryFn: vehiclesApi.savedIds, enabled: signedIn, staleTime: 60_000 });
  const toggle = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => (on ? vehiclesApi.save(id) : vehiclesApi.unsave(id)),
    onMutate: async ({ id, on }) => {
      await queryClient.cancelQueries({ queryKey: vehicleKeys.savedIds });
      const before = queryClient.getQueryData<string[]>(vehicleKeys.savedIds) ?? [];
      queryClient.setQueryData<string[]>(vehicleKeys.savedIds, on ? [id, ...before.filter(item => item !== id)] : before.filter(item => item !== id));
      return { before };
    },
    onError: (err, _vars, context) => {
      if (context) queryClient.setQueryData(vehicleKeys.savedIds, context.before);
      toast({ tone: 'error', title: 'No se pudo guardar', description: err instanceof Error ? err.message : undefined });
    },
    onSuccess: (_data, { on }) => {
      void queryClient.invalidateQueries({ queryKey: vehicleKeys.saved });
      void queryClient.invalidateQueries({ queryKey: alertKeys.overview });
      if (on) toast({ tone: 'success', title: 'Auto guardado', description: 'Lo ves en Mis alertas y te avisamos si baja de precio.' });
    },
  });
  const ids = list.data ?? [];
  return {
    signedIn,
    isSaved: (id: string) => ids.includes(id),
    toggle: (id: string) => {
      if (!signedIn) {
        router.push(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      toggle.mutate({ id, on: !ids.includes(id) });
    },
    busy: toggle.isPending,
  };
}

/**
 * Corazón de «Guardar». `tile`: fila de acciones de la ficha en PC · `round`: botón sobre la foto en el
 * teléfono (fondo opaco con borde, para que se lea sobre cualquier foto; rojo de la marca al guardar).
 */
export function SaveButton({ vehicleId, variant, className }: { vehicleId: string; variant: 'tile' | 'round'; className?: string }) {
  const saved = useSaved();
  const on = saved.isSaved(vehicleId);
  const heart = (
    <Heart
      aria-hidden
      strokeWidth={variant === 'round' ? 2 : 1.9}
      className={cn(
        'transition-transform duration-[260ms] ease-[cubic-bezier(.3,1.6,.5,1)] motion-reduce:transition-none',
        variant === 'round' ? 'size-[19px]' : 'size-5',
        on && 'scale-[1.18] fill-current',
      )}
    />
  );
  if (variant === 'round') {
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-label={on ? 'Quitar de guardados' : 'Guardar auto'}
        disabled={saved.busy}
        onClick={() => saved.toggle(vehicleId)}
        className={cn('grid size-11 place-items-center rounded-full border border-line bg-surface shadow-sm', on ? 'text-brand-fg' : 'text-ink', className)}
      >
        {heart}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={saved.busy}
      onClick={() => saved.toggle(vehicleId)}
      className={cn(className, on && 'border-danger-fg text-danger-fg')}
    >
      {heart} {on ? 'Guardado' : 'Guardar'}
    </button>
  );
}
