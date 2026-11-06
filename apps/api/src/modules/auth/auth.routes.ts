import { Router, type Request, type Response } from 'express';
import { REFRESH_TOKEN_COOKIE } from '../../shared/auth/token.service.js';
import { authenticate, currentUser } from '../../shared/http/middlewares/auth.middleware.js';
import { requireHuman } from '../../shared/http/middlewares/human-check.js';
import { bodyEmail, clientIp, consumeRateLimit, rateLimit } from '../../shared/http/middlewares/rate-limit.js';
import { validateBody } from '../../shared/http/middlewares/validate.js';
import { clearSessionCookies, setSessionCookies } from './auth.cookies.js';
import {
  ForgotPasswordSchema,
  AvatarRegisterSchema,
  AvatarUploadSchema,
  LoginSchema,
  OAuthLoginSchema,
  OAuthParamsSchema,
  ProfileUpdateSchema,
  RegisterSchema,
  ResetPasswordSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type OAuthLoginInput,
  type ProfileUpdateInput,
  type RegisterInput,
  type ResetPasswordInput,
} from './auth.schemas.js';
import { authService, type ClientContext, type PublicUser, type Session } from './auth.service.js';

const MINUTE = 60_000;

// Límites en Redis (compartidos por todas las instancias):
//   login: 10 por IP+email / 15 min y 50 por IP / 15 min (credential stuffing)
//   registro: 5 por IP / hora · recuperación: 5 por IP / hora y 3 correos por cuenta / hora
const loginByIpEmail = rateLimit({ name: 'login', windowMs: 15 * MINUTE, max: 10, key: req => `${clientIp(req)}|${bodyEmail(req)}` });
const loginByIp = rateLimit({ name: 'login-ip', windowMs: 15 * MINUTE, max: 50, key: clientIp });
const registerLimiter = rateLimit({ name: 'register', windowMs: 60 * MINUTE, max: 5, key: clientIp });
const forgotLimiter = rateLimit({ name: 'forgot', windowMs: 60 * MINUTE, max: 5, key: clientIp });
const resetLimiter = rateLimit({ name: 'reset', windowMs: 15 * MINUTE, max: 10, key: clientIp });
const sessionLimiter = rateLimit({ name: 'session', windowMs: 15 * MINUTE, max: 60, key: clientIp });
const FORGOT_PER_ACCOUNT = { name: 'forgot-email', windowMs: 60 * MINUTE, max: 3 };

const clientContext = (req: Request): ClientContext => ({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });

const readRefreshCookie = (req: Request): string | undefined => {
  const value: unknown = req.cookies?.[REFRESH_TOKEN_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/** Cookies httpOnly para la web + access token en el cuerpo (útil para el handshake de Socket.io). */
function sendSession(res: Response, status: number, payload: { user: PublicUser; session: Session; isNewUser?: boolean }) {
  setSessionCookies(res, payload.session);
  res.status(status).json({
    data: {
      user: payload.user,
      accessToken: payload.session.accessToken,
      expiresIn: payload.session.accessExpiresIn,
      ...(payload.isNewUser !== undefined && { isNewUser: payload.isNewUser }),
    },
  });
}

export const authRouter = Router();

authRouter.post('/register', registerLimiter, validateBody(RegisterSchema), requireHuman('register'), async (req, res) => {
  sendSession(res, 201, await authService.register(req.body as RegisterInput, clientContext(req)));
});

authRouter.post('/login', loginByIp, loginByIpEmail, validateBody(LoginSchema), requireHuman('login'), async (req, res) => {
  sendSession(res, 200, await authService.login(req.body as LoginInput, clientContext(req)));
});

/** POST /api/auth/oauth/google | /api/auth/oauth/apple  { idToken, nonce?, name? } */
authRouter.post('/oauth/:provider', sessionLimiter, validateBody(OAuthLoginSchema), async (req, res) => {
  const { provider } = OAuthParamsSchema.parse(req.params);
  const result = await authService.loginWithOAuth(provider, req.body as OAuthLoginInput, clientContext(req));
  sendSession(res, result.isNewUser ? 201 : 200, result);
});

/** Rota el refresh token (cookie am_rt) y emite un access token nuevo. */
authRouter.post('/refresh', sessionLimiter, async (req, res) => {
  // Visitante sin sesión: 204 en vez de 401, así la consola del navegador no marca un error en cada página.
  if (!readRefreshCookie(req)) {
    clearSessionCookies(res);
    res.status(204).end();
    return;
  }
  try {
    sendSession(res, 200, await authService.refresh(readRefreshCookie(req), clientContext(req)));
  } catch (err) {
    clearSessionCookies(res); // sesión inválida: limpiamos para que el frontend no reintente en bucle
    throw err;
  }
});

authRouter.post('/logout', async (req, res) => {
  await authService.logout(readRefreshCookie(req));
  clearSessionCookies(res);
  res.status(204).end();
});

authRouter.post('/logout-all', authenticate, async (req, res) => {
  await authService.logoutEverywhere(currentUser(req).id);
  clearSessionCookies(res);
  res.status(204).end();
});

/** Siempre 202 con el mismo mensaje: no revela si el correo está registrado. */
authRouter.post('/password/forgot', forgotLimiter, validateBody(ForgotPasswordSchema), requireHuman('forgot_password'), async (req, res) => {
  const input = req.body as ForgotPasswordInput;
  let withinAccountLimit = true;
  try {
    await consumeRateLimit(FORGOT_PER_ACCOUNT, input.email);
  } catch {
    withinAccountLimit = false; // límite por cuenta superado: se responde igual, sin enviar otro correo
  }
  if (withinAccountLimit) await authService.forgotPassword(input, clientContext(req));
  res.status(202).json({ data: { message: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.' } });
});

authRouter.post('/password/reset', resetLimiter, validateBody(ResetPasswordSchema), async (req, res) => {
  await authService.resetPassword(req.body as ResetPasswordInput, clientContext(req));
  clearSessionCookies(res);
  res.status(204).end();
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json({ data: await authService.me(currentUser(req).id) });
});

authRouter.post('/me/terms', authenticate, async (req, res) => {
  res.json({ data: await authService.acceptTerms(currentUser(req).id) });
});

authRouter.patch('/me', authenticate, validateBody(ProfileUpdateSchema), async (req, res) => {
  res.json({ data: await authService.updateProfile(currentUser(req).id, req.body as ProfileUpdateInput) });
});

authRouter.post('/me/avatar/uploads', authenticate, validateBody(AvatarUploadSchema), async (req, res) => {
  res.status(201).json({ data: await authService.requestAvatarUpload(currentUser(req).id, req.body) });
});

authRouter.put('/me/avatar', authenticate, validateBody(AvatarRegisterSchema), async (req, res) => {
  res.json({ data: await authService.registerAvatar(currentUser(req).id, req.body) });
});
