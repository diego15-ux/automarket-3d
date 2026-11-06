'use client';

import { withLocalMedia } from '@/shared/config/env';
import { Lock, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { formatDuration } from '@/shared/lib/format';
import { clock } from '../deal';
import type { ChatMessage, OutgoingMessage } from '../types';

const CONTACT_FLAGS = ['EMAIL', 'PHONE', 'URL'];
const BARS = 22;

/** Nota de voz con el aspecto del diseño (círculo de reproducir, onda y duración) y audio real. */
function VoiceNote({ url, durationMs, mine }: { url: string; durationMs: number | null; mine: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const seconds = Math.max(1, Math.round((durationMs ?? 0) / 1000));
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    const onTime = () => setProgress(element.duration ? element.currentTime / element.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    element.addEventListener('timeupdate', onTime);
    element.addEventListener('ended', onEnd);
    element.addEventListener('pause', () => setPlaying(false));
    element.addEventListener('play', () => setPlaying(true));
    return () => {
      element.removeEventListener('timeupdate', onTime);
      element.removeEventListener('ended', onEnd);
    };
  }, []);
  return (
    <div className="flex min-w-[190px] items-center gap-2.5">
      <audio ref={audio} src={url} preload="metadata" />
      <button
        type="button"
        aria-label={playing ? 'Pausar nota de voz' : 'Escuchar nota de voz'}
        onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}
        className={cn('grid size-8 shrink-0 place-items-center rounded-full', mine ? 'bg-on-mine text-mine' : 'bg-ink text-tile')}
      >
        {playing ? <Pause className="size-3.5" fill="currentColor" aria-hidden /> : <Play className="size-3.5 translate-x-px" fill="currentColor" aria-hidden />}
      </button>
      <span aria-hidden className="flex items-center gap-0.5">
        {Array.from({ length: BARS }, (_, k) => (
          <span key={k} className={cn('w-[3px] rounded-[2px] bg-current transition-opacity', k / BARS < progress ? 'opacity-100' : 'opacity-70')} style={{ height: 6 + ((k * 7 + seconds * 3) % 14) }} />
        ))}
      </span>
      <span className="font-mono text-xs font-medium">{formatDuration(seconds * 1000)}</span>
    </div>
  );
}

/** Burbuja del diseño: mía (tinta / menta) o de la otra persona; dorada si ocultamos datos de contacto. */
export function MessageBubble({ message, outgoing, mine, status, compact, onRetry, onDiscard }: {
  message?: ChatMessage;
  outgoing?: OutgoingMessage;
  mine: boolean;
  /** Solo en mi último mensaje: «Visto» o «Enviado». */
  status?: 'Visto' | 'Enviado' | null;
  /** Teléfono: burbujas un poco más anchas (82 %). */
  compact?: boolean;
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  const type = message?.type ?? outgoing?.type ?? 'TEXT';
  const body = message ? message.body : (outgoing?.text ?? null);
  // Lo que llega por el socket no pasa por el cliente de la API: se ajusta aquí la URL del almacén local.
  const mediaUrl = (message?.media?.url ? withLocalMedia(message.media.url) : undefined) ?? outgoing?.previewUrl;
  const durationMs = message?.media?.durationMs ?? outgoing?.durationMs ?? null;
  const createdAt = message?.createdAt ?? outgoing?.createdAt ?? new Date().toISOString();
  const flags = message?.moderationFlags ?? [];
  const hidden = flags.some(flag => CONTACT_FLAGS.includes(flag));
  const sending = outgoing?.state === 'sending';
  const failed = outgoing?.state === 'failed';
  const photo = type === 'IMAGE' || type === 'VIDEO';

  return (
    <div className={cn('am-step-in grid gap-[3px]', mine ? 'justify-items-end self-end' : 'justify-items-start self-start', compact ? 'max-w-[82%]' : 'max-w-[68%]')}>
      <div
        className={cn(
          'overflow-hidden',
          photo ? 'p-1.5' : 'px-3.5 py-2.5',
          mine ? 'rounded-[18px_18px_6px_18px]' : 'rounded-[18px_18px_18px_6px]',
          hidden ? 'bg-gold-soft text-ink' : mine ? 'bg-mine text-on-mine' : 'bg-tile text-ink',
          sending && 'opacity-80',
          failed && 'ring-2 ring-danger/60',
        )}
      >
        {mediaUrl && type === 'IMAGE' && (
          <a href={mediaUrl} target="_blank" rel="noreferrer" className="block">
            {/* <img> nativo: URL prefirmada temporal o blob: local (no pasan por el optimizador). */}
            <img src={mediaUrl} alt={body ? `Foto: ${body}` : 'Foto enviada en el chat'} className="h-[124px] w-[220px] max-w-full rounded-[12px] object-cover" />
          </a>
        )}
        {mediaUrl && type === 'VIDEO' && <video src={mediaUrl} controls preload="metadata" className="h-[124px] w-[220px] max-w-full rounded-[12px] bg-black object-cover" />}
        {mediaUrl && type === 'AUDIO' && <VoiceNote url={mediaUrl} durationMs={durationMs} mine={mine && !hidden} />}
        {body && <p className={cn('text-[14.5px] leading-[1.45] break-words whitespace-pre-wrap', photo && 'mx-1.5 mt-1.5 mb-0.5')}>{body}</p>}
        {hidden && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs leading-[1.4] text-gold-fg">
            <Lock className="size-4 shrink-0" aria-hidden /> Ocultamos datos de contacto hasta que se confirme una reserva.
          </p>
        )}
        {sending && outgoing?.file && outgoing.progress !== undefined && outgoing.progress < 1 && (
          <div className="mt-2 h-0.5 overflow-hidden bg-current/25" role="progressbar" aria-label="Subiendo" aria-valuenow={Math.round(outgoing.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-current transition-[width]" style={{ width: `${Math.round(outgoing.progress * 100)}%` }} />
          </div>
        )}
      </div>
      <p className="text-[11.5px] text-muted">
        {clock(createdAt)}
        {sending ? ' · Enviando…' : status ? ` · ${status}` : ''}
      </p>
      {mine && flags.includes('PROFANITY') && <p className="text-[11px] text-muted">Filtramos lenguaje ofensivo para mantener la conversación respetuosa.</p>}
      {failed && (
        <p className="text-xs text-danger-fg">
          No se envió: {outgoing?.error}{' '}
          <button type="button" onClick={onRetry} className="font-semibold underline">
            Reintentar
          </button>{' '}
          ·{' '}
          <button type="button" onClick={onDiscard} className="underline">
            Descartar
          </button>
        </p>
      )}
    </div>
  );
}
