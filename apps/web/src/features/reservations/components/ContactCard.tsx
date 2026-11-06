import type { ContactCardDTO } from '@automarket/contracts';
import { BadgeCheck, Building2, Mail, MapPin, Phone } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

/** Datos verificados de la otra parte: solo existen con la reserva confirmada (chat directo). */
export function ContactCard({ contact, className }: { contact: ContactCardDTO; className?: string }) {
  const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
  return (
    <div className={cn('rounded-md border border-success/30 bg-success/5 p-4 text-sm', className)}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-success-fg">
        <BadgeCheck className="size-4" /> Datos verificados
      </p>
      <p className="mt-2 font-semibold">{contact.name}</p>
      {contact.dealer && (
        <div className="mt-2 rounded-sm bg-gold/[0.07] p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-gold-fg">
            <Building2 className="size-3.5" /> {contact.dealer.businessName}
          </p>
          <p className="mt-1">RIF {contact.dealer.taxId}</p>
          <p>{contact.dealer.fiscalAddress}</p>
          <a href={tel(contact.dealer.businessPhone)} className="font-semibold underline-offset-2 hover:underline">
            {contact.dealer.businessPhone}
          </a>
        </div>
      )}
      <ul className="mt-2 space-y-1">
        {contact.phone && (
          <li className="flex items-center gap-2">
            <Phone className="size-3.5 text-muted" />
            <a href={tel(contact.phone)} className="underline-offset-2 hover:underline">
              {contact.phone}
            </a>
          </li>
        )}
        <li className="flex items-center gap-2">
          <Mail className="size-3.5 text-muted" />
          <a href={`mailto:${contact.email}`} className="break-all underline-offset-2 hover:underline">
            {contact.email}
          </a>
        </li>
        {contact.city && (
          <li className="flex items-center gap-2">
            <MapPin className="size-3.5 text-muted" /> {contact.city}
            {contact.country ? `, ${contact.country}` : ''}
          </li>
        )}
      </ul>
    </div>
  );
}
