import { cn } from '@/shared/lib/cn';
import { initials } from '@/shared/lib/format';

/** Colores de los avatares de los diseños (chat): uno fijo por persona según su nombre. */
const TINTS = ['#6C5CE7', '#B30E29', '#C9771A', '#2F4A7A', '#4A505A'];
const tintOf = (name: string) => TINTS[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TINTS.length];

export function Avatar({ name, src, className, tinted = false }: { name: string; src?: string | null; className?: string; tinted?: boolean }) {
  if (src) {
    // <img> nativo: los avatares vienen de proveedores OAuth con dominios variables.
    return <img src={src} alt="" referrerPolicy="no-referrer" className={cn('size-9 shrink-0 rounded-full object-cover', className)} />;
  }
  return (
    <span
      aria-hidden
      style={tinted ? { backgroundColor: tintOf(name) } : undefined}
      className={cn('grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-bold', tinted ? 'text-white' : 'bg-ink text-canvas', className)}
    >
      {initials(name)}
    </span>
  );
}
