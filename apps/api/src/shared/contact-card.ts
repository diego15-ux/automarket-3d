import type { ContactCardDTO } from '@automarket/contracts';
import type { Prisma } from '../generated/prisma/client.js';

/** Campos de un usuario que forman sus «datos verificados» (chat directo y reserva confirmada). */
export const contactSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  email: true,
  phone: true,
  city: true,
  country: true,
  isVerified: true,
  accountType: true,
  businessName: true,
  taxId: true,
  fiscalAddress: true,
  businessPhone: true,
} satisfies Prisma.UserSelect;

export type ContactRow = Prisma.UserGetPayload<{ select: typeof contactSelect }>;

/** Solo se muestra a la otra parte cuando la reserva está confirmada (o la venta concretada). */
export const contactCard = (party: ContactRow): ContactCardDTO => ({
  name: party.name,
  email: party.email,
  phone: party.phone,
  city: party.city,
  country: party.country,
  isVerified: party.isVerified,
  accountType: party.accountType,
  dealer:
    party.accountType === 'DEALER' && party.businessName && party.taxId && party.fiscalAddress && party.businessPhone
      ? { businessName: party.businessName, taxId: party.taxId, fiscalAddress: party.fiscalAddress, businessPhone: party.businessPhone }
      : null,
});
