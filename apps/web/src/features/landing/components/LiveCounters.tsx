'use client';

import type { PublicServerToClientEvents, PublicStatsDTO } from '@automarket/contracts';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { clientApiUrl, sameOriginApi } from '@/shared/config/env';
import { formatNumber } from '@/shared/lib/format';

/** Interpola el número mostrado hacia el valor nuevo (respeta reduced-motion). */
function useAnimatedNumber(target: number) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = target;
      setValue(target);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / 700);
      const current = Math.round(start + (target - start) * (1 - (1 - t) ** 3));
      setValue(current);
      from.current = current;
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

/**
 * Cifras de la portada (como el index.html): autos y usuarios llegan de MySQL y se actualizan en
 * vivo por Socket.io (namespace público /public); concesionarios y valoración vienen del servidor.
 */
export function LiveCounters({ initial, dealers, rating }: { initial: PublicStatsDTO | null; dealers: number; rating: number | null }) {
  const [stats, setStats] = useState<PublicStatsDTO | null>(initial);

  useEffect(() => {
    const socket: Socket<PublicServerToClientEvents> = io(`${clientApiUrl()}/public`, { transports: sameOriginApi() ? ['polling', 'websocket'] : ['websocket'], withCredentials: false });
    socket.on('stats', setStats);
    return () => {
      socket.disconnect();
    };
  }, []);

  const users = useAnimatedNumber(stats?.users ?? 0);
  const vehicles = useAnimatedNumber(stats?.vehicles ?? 0);
  if (!stats) return null;

  const items: Array<{ label: string; value: string }> = [
    { label: vehicles === 1 ? 'Vehículo publicado' : 'Vehículos publicados', value: formatNumber(vehicles) },
    { label: dealers === 1 ? 'Concesionario' : 'Concesionarios', value: formatNumber(dealers) },
    rating !== null
      ? { label: 'Valoración media', value: `${rating.toLocaleString('es', { maximumFractionDigits: 1 })}/5` }
      : { label: users === 1 ? 'Usuario' : 'Usuarios', value: formatNumber(users) },
    // Regla del sistema: nadie publica sin cédula, selfie y teléfono verificados.
    { label: 'Vendedores con KYC', value: '100%' },
  ];

  return (
    <dl className="mt-10 grid max-w-xl grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4" aria-live="polite">
      {items.map(item => (
        <div key={item.label} className="flex flex-col-reverse gap-1">
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd className="font-display text-2xl font-extrabold figures">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
