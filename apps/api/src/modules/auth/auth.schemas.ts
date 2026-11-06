import { z } from 'zod';

// Los esquemas compartidos con la web viven en @automarket/contracts.
export {
  AvatarRegisterSchema,
  AvatarUploadSchema,
  ForgotPasswordSchema,
  LoginSchema,
  OAuthLoginSchema,
  ProfileUpdateSchema,
  RegisterSchema,
  ResetPasswordSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type OAuthLoginInput,
  type ProfileUpdateInput,
  type RegisterInput,
  type ResetPasswordInput,
} from '@automarket/contracts';

export const OAuthParamsSchema = z.object({ provider: z.enum(['google', 'apple']) });
