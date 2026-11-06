import Link from 'next/link';
import { cn } from '@/shared/lib/cn';

/** Marca de los diseños: cuadro verde con «3D» y «AutoMarket» en negrita. */
export function Logo({ href = '/vehiculos', className, tone = 'auto' }: { href?: string; className?: string; tone?: 'auto' | 'night' }) {
  return (
    <Link href={href} className={cn('group flex shrink-0 items-center gap-2.5', tone === 'night' ? 'text-white' : 'text-ink', className)} aria-label="AutoMarket 3D, ir al inicio">
      <span className={cn('grid size-8 place-items-center rounded-[9px] text-[12px] font-extrabold', tone === 'night' ? 'bg-brand text-on-brand' : 'bg-brand text-on-brand')}>3D</span>
      <span className="text-[18px] leading-none font-extrabold tracking-[-0.03em]">AutoMarket</span>
    </Link>
  );
}
