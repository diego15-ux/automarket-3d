'use client';

import { ArrowRight, Mic, Paperclip } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { formatDuration } from '@/shared/lib/format';
import { useToast } from '@/shared/ui/toaster';
import { MAX_VOICE_NOTE_MS, useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { EmojiPicker } from './EmojiPicker';

const ACCEPTED_FILES = 'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime';
const MAX_TEXTAREA_HEIGHT = 144;

/** Compositor del diseño: adjuntar, emojis, campo en píldora y Enviar / micrófono. */
export function Composer({ onSendText, onSendFile, onTyping, voiceEnabled }: {
  onSendText: (text: string) => void;
  onSendFile: (file: File, extra?: { durationMs?: number }) => void;
  onTyping: () => void;
  /** Notas de voz: solo en el chat directo (reserva confirmada), porque el audio no se puede filtrar. */
  voiceEnabled: boolean;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Crece con el texto hasta 144 px; al enviar vuelve a una línea.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 46), MAX_TEXTAREA_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
  }, [text]);
  const voice = useVoiceRecorder((file, durationMs) => onSendFile(file, { durationMs }));

  function submit() {
    if (!text.trim()) return;
    onSendText(text);
    setText('');
  }

  function insertEmoji(emoji: string) {
    const el = textarea.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    onTyping();
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  if (voice.recording) {
    return (
      <div className="am-step-in flex h-12 items-center gap-2.5">
        <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />
        <p aria-live="polite" className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
          Grabando {formatDuration(voice.elapsedMs)}
          <span className="font-medium text-muted"> · máx. {formatDuration(MAX_VOICE_NOTE_MS)}</span>
        </p>
        <button type="button" onClick={voice.cancel} className="h-10 rounded-full border border-field-line px-3.5 text-[13px] font-bold">
          Descartar
        </button>
        <button type="button" onClick={voice.stop} className="h-10 rounded-full bg-brand px-4 text-[13px] font-bold text-on-brand">
          Enviar nota
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}
    >
      {voice.error && <p className="mb-2 px-2 text-xs text-danger-fg">{voice.error}</p>}
      <div className="flex items-end gap-1.5">
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_FILES}
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) onSendFile(file);
            event.target.value = '';
          }}
        />
        <button type="button" onClick={() => fileInput.current?.click()} aria-label="Adjuntar foto o video" className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-tile hover:text-ink">
          <Paperclip className="size-5" strokeWidth={1.9} aria-hidden />
        </button>
        <EmojiPicker onPick={insertEmoji} />
        <label className="sr-only" htmlFor="chat-message">
          Escribe un mensaje
        </label>
        <textarea
          id="chat-message"
          ref={textarea}
          rows={1}
          value={text}
          autoComplete="off"
          placeholder="Escribe un mensaje…"
          className="min-h-[46px] min-w-0 flex-1 resize-none overflow-y-hidden rounded-[23px] border border-field-line bg-field px-4 py-[11px] text-base leading-[22px] font-medium placeholder:text-faint sm:text-[15px]"
          onChange={event => {
            setText(event.target.value);
            onTyping();
          }}
          onKeyDown={event => {
            // Enter envía; Shift+Enter hace salto de línea (sin interrumpir la composición IME).
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {text.trim() ? (
          <button type="submit" aria-label="Enviar" className="grid size-[46px] shrink-0 place-items-center rounded-full bg-brand text-on-brand">
            <ArrowRight className="size-[18px]" strokeWidth={2.4} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => (voiceEnabled ? voice.start() : toast({ tone: 'info', title: 'Las notas de voz se activan cuando el vendedor confirma la reserva.' }))}
            aria-label={voiceEnabled ? 'Grabar nota de voz' : 'Nota de voz (se activa con la reserva confirmada)'}
            title={voiceEnabled ? 'Grabar nota de voz' : 'Las notas de voz se activan cuando el vendedor confirma la reserva'}
            className={cn('grid size-[46px] shrink-0 place-items-center rounded-full border border-field-line', voiceEnabled ? 'bg-field text-ink' : 'bg-transparent text-faint opacity-60')}
          >
            <Mic className="size-5" strokeWidth={1.9} aria-hidden />
          </button>
        )}
      </div>
    </form>
  );
}
