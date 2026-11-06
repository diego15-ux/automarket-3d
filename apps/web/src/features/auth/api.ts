import { AvatarUploadSchema, type ForgotPasswordInput, type LoginInput, type ProfileUpdateInput, type PublicUser, type RegisterInput, type ResetPasswordInput } from '@automarket/contracts';
import { api, apiFetch } from '@/shared/lib/http';
import { sessionStore, type SessionPayload } from '@/shared/lib/session';
import { uploadToStorage } from '@/shared/lib/upload';

export type OAuthProvider = 'google' | 'apple';

type Envelope<T> = { data: T };

/** Toda respuesta de sesión actualiza el store: la UI y Socket.io reaccionan solos. */
async function startSession(request: Promise<Envelope<SessionPayload>>): Promise<SessionPayload> {
  const { data } = await request;
  sessionStore.set(data);
  return data;
}

/** Tras editar el perfil, la sesión en memoria refleja los datos nuevos (país, ciudad…). */
function updateSessionUser(user: PublicUser) {
  const current = sessionStore.get();
  if (current.status === 'authenticated') sessionStore.set({ user, accessToken: current.accessToken, expiresIn: 0 });
}

export const authApi = {
  login: (input: LoginInput) => startSession(apiFetch<Envelope<SessionPayload>>('/api/auth/login', { method: 'POST', body: input, skipRefresh: true })),

  register: (input: RegisterInput) => startSession(apiFetch<Envelope<SessionPayload>>('/api/auth/register', { method: 'POST', body: input, skipRefresh: true })),

  oauth: (provider: OAuthProvider, input: { idToken: string; nonce?: string; name?: string }) =>
    startSession(apiFetch<Envelope<SessionPayload>>(`/api/auth/oauth/${provider}`, { method: 'POST', body: input, skipRefresh: true })),

  forgotPassword: (input: ForgotPasswordInput) =>
    apiFetch<Envelope<{ message: string }>>('/api/auth/password/forgot', { method: 'POST', body: input, skipRefresh: true }).then(res => res.data.message),

  resetPassword: (input: ResetPasswordInput) => apiFetch<void>('/api/auth/password/reset', { method: 'POST', body: input, skipRefresh: true }),

  async updateProfile(input: ProfileUpdateInput): Promise<PublicUser> {
    const user = await api.patch<PublicUser>('/api/auth/me', input);
    updateSessionUser(user);
    return user;
  },

  async updateAvatar(file: File): Promise<PublicUser> {
    const parsed = AvatarUploadSchema.safeParse({ mimeType: file.type, sizeBytes: file.size });
    if (!parsed.success) throw new Error('Sube una imagen JPG, PNG o WEBP de máximo 5 MB.');
    const { data: upload } = await apiFetch<{ data: { key: string; uploadUrl: string; method: 'PUT'; headers: Record<string, string>; expiresIn: number } }>('/api/auth/me/avatar/uploads', { method: 'POST', body: parsed.data });
    await uploadToStorage(upload, file);
    const user = await api.put<PublicUser>('/api/auth/me/avatar', { key: upload.key });
    updateSessionUser(user);
    return user;
  },

  /** Acepta la versión vigente de los Términos (página /terminos). */
  async acceptTerms(): Promise<PublicUser> {
    const user = await api.post<PublicUser>('/api/auth/me/terms', {});
    updateSessionUser(user);
    return user;
  },

  /** Relee el usuario (p. ej. tras pagar una membresía) y actualiza la sesión. */
  async reloadMe(): Promise<PublicUser> {
    const user = await api.get<PublicUser>('/api/auth/me');
    updateSessionUser(user);
    return user;
  },

  async logout(): Promise<void> {
    try {
      await apiFetch<void>('/api/auth/logout', { method: 'POST', skipRefresh: true });
    } finally {
      sessionStore.set(null, { broadcastLogout: true });
    }
  },
};
