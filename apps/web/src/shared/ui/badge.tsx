import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

type Tone = 'neutral' | 'brand' | 'gold' | 'success' | 'danger';

/** Etiqueta de estado en píldora con fondo suave, como «Verificado» o «En negociación» en los diseños. */
const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted',
  brand: 'bg-soft text-brand-fg',
  gold: 'bg-gold-soft text-gold-fg',
  success: 'bg-success-soft text-success-fg',
  danger: 'bg-danger-soft text-danger-fg',
};

export function Badge({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] leading-none font-bold whitespace-nowrap', TONES[tone], className)}>{children}</span>;
}
