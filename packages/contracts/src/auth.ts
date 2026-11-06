import { z } from 'zod';
import { ACCOUNT_TYPES, type AccountType, type BillingCycle, type PlanCode, type Role } from './enums.js';
import { CitySchema, CountrySchema } from './geo.js';

/** '' en formularios = "sin valor". */
const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

export const PhoneSchema = z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, 'Teléfono inválido.');

/**
 * RIF venezolano: letra (V, E, J, P o G) + 8 dígitos + dígito verificador. Se guarda como «J-12345678-9».
 * Fuera de Venezuela se acepta la identificación fiscal local (RFC, NIF…) en mayúsculas y sin espacios.
 */
const RIF_PATTERN = /^([VEJPG])-?(\d{8})-?(\d)$/;
export const normalizeTaxId = (value: string) => {
  const compact = value.trim().toUpperCase().replace(/\s+/g, '');
  const rif = RIF_PATTERN.exec(compact);
  return rif ? `${rif[1]}-${rif[2]}-${rif[3]}` : compact;
};
export const isRif = (value: string) => /^[VEJPG]-\d{8}-\d$/.test(value);
export const TaxIdSchema = z
  .string()
  .max(30)
  .transform(normalizeTaxId)
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9.-]{4,19}$/, 'Identificación fiscal inválida.'));

/** Datos fiscales obligatorios de un concesionario (visibles en su perfil e insignia). */
export const DealerFieldsSchema = z.object({
  businessName: z.string().trim().min(2, 'Indica la razón social.').max(160),
  taxId: TaxIdSchema,
  fiscalAddress: z.string().trim().min(5, 'Indica la dirección fiscal.').max(300),
  businessPhone: PhoneSchema,
});
export type DealerFields = z.infer<typeof DealerFieldsSchema>;

const optionalDealerFields = {
  businessName: z.preprocess(blankToUndefined, DealerFieldsSchema.shape.businessName.optional()),
  taxId: z.preprocess(blankToUndefined, TaxIdSchema.optional()),
  fiscalAddress: z.preprocess(blankToUndefined, DealerFieldsSchema.shape.fiscalAddress.optional()),
  businessPhone: z.preprocess(blankToUndefined, PhoneSchema.optional()),
};

/** Un concesionario debe traer todos sus datos fiscales; en Venezuela, un RIF válido. */
function checkDealerFields(
  value: { accountType?: AccountType; country?: string; businessName?: string; taxId?: string; fiscalAddress?: string; businessPhone?: string },
  ctx: z.RefinementCtx,
) {
  if (value.accountType !== 'DEALER') return;
  const missing = { businessName: 'Indica la razón social.', taxId: 'Indica el RIF.', fiscalAddress: 'Indica la dirección fiscal.', businessPhone: 'Indica el teléfono corporativo.' } as const;
  for (const [field, message] of Object.entries(missing)) {
    if (!value[field as keyof typeof missing]) ctx.addIssue({ code: 'custom', path: [field], message });
  }
  if (value.taxId && value.country === 'VE' && !isRif(value.taxId)) {
    ctx.addIssue({ code: 'custom', path: ['taxId'], message: 'RIF inválido. Formato: J-12345678-9.' });
  }
}

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email('Correo electrónico inválido.').max(254));

export const PasswordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .max(128)
  .refine(value => /[A-Za-z]/.test(value) && /\d/.test(value), 'Incluye al menos una letra y un número.');

/**
 * Campos anti-bot que acompañan a los formularios públicos:
 * - captchaToken: token de Cloudflare Turnstile.
 * - website: honeypot oculto; una persona nunca lo rellena.
 */
export const HumanCheckSchema = z.object({
  captchaToken: z.string().max(4096).optional(),
  website: z.string().max(200).optional(),
});

export const RegisterSchema = z
  .object({
    name: z.string().trim().min(2, 'Ingresa tu nombre (mínimo 2 caracteres).').max(120),
    email: EmailSchema,
    password: PasswordSchema,
    country: CountrySchema,
    city: CitySchema,
    accountType: z.enum(ACCOUNT_TYPES).default('INDIVIDUAL'),
    ...optionalDealerFields,
    acceptTerms: z.literal(true, { error: 'Debes aceptar los Términos y la Política de Privacidad.' }),
    ...HumanCheckSchema.shape,
  })
  .superRefine(checkDealerFields);
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Ingresa tu contraseña.').max(128),
  ...HumanCheckSchema.shape,
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const ForgotPasswordSchema = z.object({ email: EmailSchema, ...HumanCheckSchema.shape });
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: PasswordSchema,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

/**
 * Perfil editable; los usuarios de Google/Apple completan aquí país y ciudad. El tipo de cuenta y
 * el RIF solo se cambian antes de verificar la identidad (la API lo comprueba).
 */
export const ProfileUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    bio: z.string().trim().max(500, 'La biografía no puede superar 500 caracteres.').optional(),
    phone: z.preprocess(blankToUndefined, PhoneSchema.optional()),
    country: CountrySchema.optional(),
    city: CitySchema.optional(),
    accountType: z.enum(ACCOUNT_TYPES).optional(),
    ...optionalDealerFields,
    /** Horario de atención de la agencia (texto libre, sale en su página pública). Vacío = sin horario. */
    businessHours: z.string().trim().max(120, 'El horario no puede superar 120 caracteres.').optional(),
  })
  .superRefine(checkDealerFields);
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;

export const AvatarUploadSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
});

export const AvatarRegisterSchema = z.object({
  key: z.string().min(10).max(512),
});

export const OAuthLoginSchema = z.object({
  idToken: z.string().min(20).max(8192),
  nonce: z.string().min(8).max(256).optional(),
  name: z.string().trim().min(2).max(120).optional(),
});
export type OAuthLoginInput = z.infer<typeof OAuthLoginSchema>;

/** Usuario tal como lo ve el frontend. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  role: Role;
  accountType: AccountType;
  /** Identidad verificada (cédula + selfie + teléfono; RIF en concesionarios): requisito para publicar y reservar. */
  isVerified: boolean;
  phone: string | null;
  country: string | null;
  city: string | null;
  /** Datos fiscales (solo concesionarios). */
  dealer: DealerFields | null;
  /** Horario de atención (solo concesionarios; lo escribe la agencia). */
  businessHours: string | null;
  /** Plan efectivo (si el pagado venció, FREE). */
  plan: { code: PlanCode; cycle: BillingCycle | null; expiresAt: string | null; daysRemaining: number | null };
  /** Falta país/ciudad (cuentas creadas con Google/Apple). */
  needsProfile: boolean;
  /** Comisiones post-venta vencidas sin pagar: bloquean publicar y reservar. */
  overdueCommissions: number;
  /** Cuándo aceptó los Términos (null = nunca; si es anterior a su actualización, se pide aceptar la nueva). */
  termsAcceptedAt: string | null;
}

export interface SessionPayload {
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
}
