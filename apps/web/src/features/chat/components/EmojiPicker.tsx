'use client';

import { Smile } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { preferencesAllowed } from '@/shared/lib/cookie-consent';

const CATEGORIES: Array<{ id: string; label: string; emojis: string[] }> = [
  // Los 16 del diseño, primero: los que más se usan al hablar de un auto.
  { id: 'frecuentes', label: '⭐', emojis: ['😀', '👍', '🙏', '🚗', '🔑', '✅', '🤝', '📍', '💬', '😅', '🙌', '❤️', '🔥', '👀', '📸', '⏰'] },
  { id: 'caras', label: '😀', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😎', '🤩', '🥳', '🤔', '🤨', '😐', '🙄', '😏', '😬', '😌', '😴', '😮', '😲', '😳', '🥺', '😢', '😭', '😤', '😡', '🤯', '👀'] },
  { id: 'gestos', label: '👍', emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤝', '👏', '🙌', '🙏', '💪', '👋', '🤙', '☝️', '👉', '👈', '👇', '✋', '🤷', '🤦'] },
  { id: 'autos', label: '🚗', emojis: ['🚗', '🚙', '🏎️', '🚕', '🛻', '🚚', '🚐', '🏍️', '🛵', '⛽', '🔧', '🔩', '🛞', '🚦', '🛣️', '🅿️', '🔑', '📍', '🗺️', '🧭'] },
  { id: 'objetos', label: '💰', emojis: ['💰', '💵', '💳', '🧾', '📄', '📝', '📅', '⏰', '📞', '📱', '💬', '📷', '🎥', '🔍', '🔒', '✅', '❌', '⚠️', '❓', '❗', '💯', '🎉', '🎁'] },
  { id: 'corazones', label: '❤️', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💕', '💖', '⭐', '🌟', '✨', '🔥'] },
];

const RECENT_KEY = 'automarket:recent-emojis';

function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 16) : [];
  } catch {
    return [];
  }
}

function saveRecent(emoji: string, current: string[]) {
  const next = [emoji, ...current.filter(item => item !== emoji)].slice(0, 16);
  try {
    // Solo si la persona dejó encendidas las cookies de «Preferencias».
    if (preferencesAllowed()) localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Navegación privada o almacenamiento bloqueado: los recientes duran solo esta sesión.
  }
  return next;
}

/** Selector de emojis del chat: categorías, recientes (en este navegador) y teclado (Esc cierra). */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [category, setCategory] = useState('frecuentes');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setRecent(readRecent());
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const tabs = recent.length ? [{ id: 'recientes', label: '🕘', emojis: recent }, ...CATEGORIES] : CATEGORIES;
  const active = tabs.find(tab => tab.id === category) ?? tabs[0]!;

  return (
    <div ref={root} className="relative">
      <button type="button" onClick={() => setOpen(value => !value)} aria-label="Emojis" aria-expanded={open} aria-haspopup="dialog" className="grid size-11 place-items-center rounded-full text-muted hover:bg-tile hover:text-ink">
        <Smile className="size-5" strokeWidth={1.9} aria-hidden />
      </button>
      {open && (
        <div role="dialog" aria-label="Emojis" className="am-step-in absolute bottom-[58px] left-0 z-20 w-[318px] max-w-[calc(100vw-24px)] rounded-[16px] border border-line bg-surface p-2 shadow-[0_16px_30px_-14px_rgb(0_0_0/0.35)]">
          <div role="tablist" aria-label="Categorías" className="flex gap-1 border-b border-line pb-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active.id === tab.id}
                aria-label={tab.id}
                onClick={() => setCategory(tab.id)}
                className={cn('rounded-[10px] px-2 py-1 text-lg transition', active.id === tab.id ? 'bg-soft' : 'hover:bg-tile')}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="mt-2 grid max-h-48 grid-cols-[repeat(8,36px)] gap-0.5 overflow-y-auto">
            {active.emojis.map(emoji => (
              <button
                key={emoji}
                type="button"
                aria-label={`Insertar ${emoji}`}
                onClick={() => {
                  onPick(emoji);
                  setRecent(current => saveRecent(emoji, current));
                }}
                className="grid size-9 place-items-center rounded-[10px] text-xl transition hover:bg-tile focus-visible:bg-tile"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
