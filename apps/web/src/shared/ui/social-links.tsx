import { SOCIAL_NETWORK_LABELS, type SocialLinkDTO } from '@automarket/contracts';
import { cn } from '@/shared/lib/cn';

/** Redes oficiales que el administrador puso en el panel: píldoras de texto con «↗», como en los diseños. */
export function SocialLinks({ links, label = 'Síguenos', tone = 'paper', className }: { links: SocialLinkDTO[]; label?: string; tone?: 'paper' | 'dark'; className?: string }) {
  if (links.length === 0) return null;
  const dark = tone === 'dark';
  return (
    <nav aria-label="Redes sociales de AutoMarket" className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className={cn('mr-1 text-[13px]', dark ? 'text-[#a2a7b0]' : 'text-muted')}>{label}</span>
      {links.map(link => (
        <a
          key={link.network}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors',
            dark ? 'h-[34px] border-[#3b3f46] text-[#f2f3f5] hover:border-[#6b717b]' : 'h-10 border-line text-ink hover:border-edge',
          )}
        >
          {SOCIAL_NETWORK_LABELS[link.network]}
          <span aria-hidden className={dark ? 'text-mint' : 'text-brand-fg'}>
            ↗
          </span>
        </a>
      ))}
    </nav>
  );
}
