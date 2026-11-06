'use client';

import type { VehicleCardDTO } from '@automarket/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { useSession } from '@/shared/lib/use-session';
import { useToast } from '@/shared/ui/toaster';
import { vehicleKeys, vehiclesApi } from './api';

/** Máximo de autos lado a lado en el comparador (diseño «Comparar autos»). */
export const MAX_COMPARE = 3;

/** Lo mínimo para mostrar la barra y abrir el comparador; los datos completos se piden a la API. */
export interface ComparePick {
  id: string;
  slug: string;
  name: string;
  coverUrl: string | null;
}

const KEY = 'automarket.comparar.v1';
const EMPTY: ComparePick[] = [];
let cache: ComparePick[] | null = null;
const listeners = new Set<() => void>();

function read(): ComparePick[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as ComparePick[]) : [];
    cache = Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === 'string' && typeof item.slug === 'string').slice(0, MAX_COMPARE) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: ComparePick[]) {
  cache = next.slice(0, MAX_COMPARE);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* sin almacenamiento: la selección dura mientras la página siga abierta */
  }
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export const pickOf = (vehicle: Pick<VehicleCardDTO, 'id' | 'slug' | 'make' | 'model' | 'version' | 'coverUrl'>): ComparePick => ({
  id: vehicle.id,
  slug: vehicle.slug,
  name: `${vehicle.make} ${vehicle.model}${vehicle.version ? ` ${vehicle.version}` : ''}`,
  coverUrl: vehicle.coverUrl,
});

/** Selección para comparar: vive en este navegador y se comparte entre pestañas. */
export function useCompare() {
  const picks = useSyncExternalStore(subscribe, read, () => EMPTY);
  const has = (id: string) => picks.some(item => item.id === id);
  return {
    picks,
    has,
    full: picks.length >= MAX_COMPARE,
    toggle: (pick: ComparePick) => write(has(pick.id) ? picks.filter(item => item.id !== pick.id) : picks.length >= MAX_COMPARE ? picks : [...picks, pick]),
    remove: (id: string) => write(picks.filter(item => item.id !== id)),
    clear: () => write([]),
  };
}

/** «Avísame si vuelve»: autos en negociación que la persona espera (necesita sesión). */
export function useWatching() {
  const session = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const signedIn = session.status === 'authenticated';
  const list = useQuery({ queryKey: vehicleKeys.watching, queryFn: vehiclesApi.watching, enabled: signedIn, staleTime: 60_000 });
  const toggle = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => (on ? vehiclesApi.watch(id) : vehiclesApi.unwatch(id)),
    onMutate: async ({ id, on }) => {
      await queryClient.cancelQueries({ queryKey: vehicleKeys.watching });
      const before = queryClient.getQueryData<string[]>(vehicleKeys.watching) ?? [];
      queryClient.setQueryData<string[]>(vehicleKeys.watching, on ? [...before.filter(item => item !== id), id] : before.filter(item => item !== id));
      return { before };
    },
    onError: (err, _vars, context) => {
      if (context) queryClient.setQueryData(vehicleKeys.watching, context.before);
      toast({ tone: 'error', title: 'No se pudo guardar el aviso', description: err instanceof Error ? err.message : undefined });
    },
    onSuccess: (_data, { on }) => {
      if (on) toast({ tone: 'success', title: 'Te avisamos si vuelve', description: 'Si la negociación no se concreta, te llega una notificación.' });
    },
  });
  const ids = list.data ?? [];
  return {
    signedIn,
    isWatching: (id: string) => ids.includes(id),
    toggle: (id: string) => toggle.mutate({ id, on: !ids.includes(id) }),
    busy: toggle.isPending,
  };
}
