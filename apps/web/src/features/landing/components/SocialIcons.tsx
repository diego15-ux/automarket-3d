import { SOCIAL_NETWORK_LABELS, type SocialLinkDTO, type SocialNetwork } from '@automarket/contracts';
import { MessageCircle, Music2, Send } from 'lucide-react';
import type { ReactNode } from 'react';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Íconos de trazo fino del pie (como el index.html). */
const ICONS: Record<SocialNetwork, ReactNode> = {
  INSTAGRAM: (
    <svg viewBox="0 0 24 24" className="size-[18px]" {...stroke}>
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5h.01" />
    </svg>
  ),
  X: (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
  LINKEDIN: (
    <svg viewBox="0 0 24 24" className="size-[18px]" {...stroke}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6ZM2 9h4v12H2z" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  ),
  YOUTUBE: (
    <svg viewBox="0 0 24 24" className="size-[18px]" {...stroke}>
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </svg>
  ),
  FACEBOOK: (
    <svg viewBox="0 0 24 24" className="size-[18px]" {...stroke}>
      <path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V10H6.5v3.5H9V21h3.5v-7.5H15l.5-3.5h-3V7a1 1 0 0 1 1-1H15z" />
    </svg>
  ),
  TIKTOK: <Music2 className="size-[18px]" strokeWidth={1.8} />,
  WHATSAPP: <MessageCircle className="size-[18px]" strokeWidth={1.8} />,
  TELEGRAM: <Send className="size-[17px]" strokeWidth={1.8} />,
};

/** Redes oficiales que el administrador puso en el panel, como botones redondos. */
export function SocialIcons({ links, className }: { links: SocialLinkDTO[]; className?: string }) {
  if (links.length === 0) return null;
  return (
    <nav aria-label="Redes sociales de AutoMarket" className={className}>
      <ul className="flex flex-wrap gap-2">
        {links.map(link => (
          <li key={link.network}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`AutoMarket en ${SOCIAL_NETWORK_LABELS[link.network]}`}
              title={SOCIAL_NETWORK_LABELS[link.network]}
              className="grid size-10 place-items-center rounded-full border border-line bg-surface text-ink transition-colors hover:border-edge"
            >
              {ICONS[link.network]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
