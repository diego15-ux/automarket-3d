import type {
  AccountType,
  AdminActivityDTO,
  AdminCalendarDTO,
  AdminCopilotDTO,
  AdminPaymentCountsDTO,
  AdminSearchDTO,
  PaymentDTO,
  AdminStatsDTO,
  ReportChatDTO,
  ReportDecisionInput,
  ReportsBoardDTO,
  AdminBrandDTO,
  AdminCommissionDTO,
  AdminMetricsDTO,
  AdminSettingsDTO,
  BillingCycle,
  BinancePayeeUpdateInput,
  BrandCreateInput,
  BrandUpdateInput,
  ExportDataset,
  ExportFormat,
  MissingBrandDTO,
  PlanCode,
  PlanDTO,
  PlanUpdateInput,
  PlatformSettingsInput,
  PublicUser,
  ReportStatus,
  Role,
  ReviewStatus,
  SettingsHistoryEntryDTO,
  SocialLinkDTO,
  VehicleCardDTO,
  VehicleStatus,
} from '@automarket/contracts';
import { clientApiUrl } from '@/shared/config/env';
import { ApiError, api, refreshSession } from '@/shared/lib/http';
import type { PresignedUpload } from '@/shared/lib/upload';

export interface Page<T> {
  items: T[];
  total: number;
  pageSize: number;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'ACTIVE' | 'SUSPENDED';
  accountType: AccountType;
  businessName: string | null;
  taxId: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  isVerified: boolean;
  planCode: PlanCode;
  plan: PublicUser['plan'];
  createdAt: string;
  vehicles: number;
}

export type PlanUpdate = PlanUpdateInput;

export type InventoryItem = VehicleCardDTO & { sellerName: string; sellerEmail: string; createdAt: string; expiresAt: string | null; openReports: number };

export interface CarouselAdmin {
  curated: Array<{ isActive: boolean; position: number; vehicle: VehicleCardDTO }>;
  featured: Array<VehicleCardDTO & { featuredUntil: string | null }>;
  featuredTotal: number;
}

export interface MarketInfluenceCandidate {
  vehicle: VehicleCardDTO;
  contactCount: number;
  reservationCount: number;
  influenceScore: number;
}

export interface AdminReport {
  id: string;
  /** VEHICLE: denuncia de un anuncio · CHAT: reporte de una persona desde el chat. */
  kind: 'VEHICLE' | 'CHAT';
  reason: string;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
  vehicle: { id: string; slug: string; make: string; model: string; year: number; status: VehicleStatus };
  reporter: { name: string; email: string };
  reportedUser: { id: string; name: string; email: string } | null;
}

export interface AdminReview {
  id: string;
  rating: number;
  comment: string;
  status: ReviewStatus;
  createdAt: string;
  user: { name: string; email: string; city: string | null };
}

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  message: string;
  status: 'NEW' | 'HANDLED';
  createdAt: string;
}

/** Pago en la bandeja del panel (con datos de la cuenta que pagó). */
export type AdminPayment = PaymentDTO & {
  user: { name: string; email: string; accountType: AccountType; businessName: string | null; isVerified: boolean };
  payerBinanceId: string | null;
  failureReason: string | null;
};

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).flatMap(([key, value]) => (value === undefined || value === '' ? [] : [[key, String(value)]])));
  return search.size ? `?${search}` : '';
};

export const adminKeys = {
  metrics: ['admin', 'metrics'] as const,
  metricsFor: (months: number) => ['admin', 'metrics', months] as const,
  calendar: (month: string) => ['admin', 'calendar', month] as const,
  activity: ['admin', 'activity'] as const,
  search: (q: string) => ['admin', 'search', q] as const,
  payments: (view: string) => ['admin', 'payments', view] as const,
  paymentCounts: ['admin', 'payments', 'counts'] as const,
  stats: ['admin', 'stats'] as const,
  copilot: ['admin', 'copilot'] as const,
  users: (filters: object) => ['admin', 'users', filters] as const,
  plans: ['admin', 'plans'] as const,
  settings: ['admin', 'settings'] as const,
  inventory: (filters: object) => ['admin', 'inventory', filters] as const,
  carousel: ['admin', 'carousel'] as const,
  marketRecommendations: ['admin', 'carousel', 'recommendations'] as const,
  reports: (status: string) => ['admin', 'reports', status] as const,
  reportsBoard: (status: string) => ['admin', 'reports-board', status] as const,
  reportChat: (id: string) => ['admin', 'report-chat', id] as const,
  reviews: (status: string) => ['admin', 'reviews', status] as const,
  terms: ['admin', 'terms'] as const,
  contact: ['admin', 'contact'] as const,
  history: ['admin', 'settings', 'history'] as const,
  brands: ['admin', 'catalog', 'brands'] as const,
  missingBrands: ['admin', 'catalog', 'missing'] as const,
};

export const adminApi = {
  stats: () => api.get<AdminStatsDTO>('/api/admin/stats'),
  copilot: () => api.get<AdminCopilotDTO>('/api/admin/copilot'),
  metrics: (months = 12) => api.get<AdminMetricsDTO>(`/api/admin/metrics?months=${months}`),
  calendar: (month: string) => api.get<AdminCalendarDTO>(`/api/admin/overview/calendar?month=${month}`),
  activity: () => api.get<AdminActivityDTO[]>('/api/admin/overview/activity'),
  search: (q: string) => api.get<AdminSearchDTO>(`/api/admin/search${qs({ q })}`),
  payments: (view: 'review' | 'refunds' | 'all') => api.get<AdminPayment[]>(`/api/admin/payments?view=${view}`),
  paymentCounts: () => api.get<AdminPaymentCountsDTO>('/api/admin/payments/counts'),
  reviewPayment: (id: string, decision: 'APPROVE' | 'REJECT', note?: string) => api.post<void>(`/api/admin/payments/${id}/review`, { decision, note }),
  refundSent: (id: string, refundTxId: string) => api.post<void>(`/api/admin/payments/${id}/refund-sent`, { refundTxId }),

  users: (filters: { q?: string; plan?: string; status?: string; page?: number }) => api.get<Page<AdminUser>>(`/api/admin/users${qs(filters)}`),
  setUserStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED') => api.patch<void>(`/api/admin/users/${id}/status`, { status }),
  setUserRole: (id: string, role: Exclude<Role, 'ADMIN_ONE'>) => api.patch<void>(`/api/admin/users/${id}/role`, { role }),
  grantMembership: (id: string, input: { planCode: PlanCode; cycle: BillingCycle; periods: number; note?: string }) => api.post<void>(`/api/admin/users/${id}/membership`, input),

  plans: () => api.get<PlanDTO[]>('/api/admin/plans'),
  updatePlan: (code: PlanCode, input: PlanUpdate) => api.patch<PlanDTO>(`/api/admin/plans/${code}`, input),
  settings: () => api.get<AdminSettingsDTO>('/api/admin/settings'),
  updateSettings: (input: PlatformSettingsInput) => api.put<AdminSettingsDTO>('/api/admin/settings', input),
  updateTerms: (content: string) => api.put<AdminSettingsDTO>('/api/admin/settings/terms', { content }),
  presignLoginBackground: (input: { mimeType: string; sizeBytes: number }) => api.post<PresignedUpload>('/api/admin/settings/login-background/upload', input),
  setLoginBackground: (key: string) => api.put<AdminSettingsDTO>('/api/admin/settings/login-background', { key }),
  removeLoginBackground: () => api.delete('/api/admin/settings/login-background'),
  presignHomeHero: (input: { mimeType: string; sizeBytes: number }) => api.post<PresignedUpload>('/api/admin/settings/home-hero/upload', input),
  setHomeHero: (key: string) => api.put<AdminSettingsDTO>('/api/admin/settings/home-hero', { key }),
  removeHomeHero: () => api.delete('/api/admin/settings/home-hero'),
  commissions: () => api.get<AdminCommissionDTO[]>('/api/admin/commissions'),

  /** Cuenta de cobro de Binance: la API solo deja cambiarla al administrador principal. */
  updateBinancePayee: (input: BinancePayeeUpdateInput) => api.put<AdminSettingsDTO>('/api/admin/settings/binance', input),
  presignBinanceQr: (input: { mimeType: string; sizeBytes: number }) => api.post<PresignedUpload>('/api/admin/settings/binance/qr/upload', input),
  setBinanceQr: (key: string) => api.put<AdminSettingsDTO>('/api/admin/settings/binance/qr', { key }),
  removeBinanceQr: () => api.delete('/api/admin/settings/binance/qr'),
  updateSocialLinks: (links: SocialLinkDTO[]) => api.put<AdminSettingsDTO>('/api/admin/settings/social', { links }),
  settingsHistory: (limit = 50) => api.get<SettingsHistoryEntryDTO[]>(`/api/admin/settings/history?limit=${limit}`),

  brands: () => api.get<AdminBrandDTO[]>('/api/admin/catalog/brands'),
  missingBrands: () => api.get<MissingBrandDTO[]>('/api/admin/catalog/missing'),
  importBrandsFromListings: () => api.post<AdminBrandDTO[]>('/api/admin/catalog/import-from-listings'),
  createBrand: (input: BrandCreateInput) => api.post<AdminBrandDTO[]>('/api/admin/catalog/brands', input),
  updateBrand: (id: string, input: BrandUpdateInput) => api.patch<AdminBrandDTO[]>(`/api/admin/catalog/brands/${id}`, input),
  addModels: (id: string, names: string[]) => api.post<AdminBrandDTO[]>(`/api/admin/catalog/brands/${id}/models`, { names }),
  setModelActive: (id: string, isActive: boolean) => api.patch<AdminBrandDTO[]>(`/api/admin/catalog/models/${id}`, { isActive }),

  inventory: (filters: { q?: string; status?: string; page?: number }) => api.get<Page<InventoryItem> & { byStatus: Record<string, number> }>(`/api/admin/vehicles${qs(filters)}`),
  archiveVehicle: (id: string, reason?: string) => api.post<void>(`/api/admin/vehicles/${id}/archive`, { reason }),

  carousel: () => api.get<CarouselAdmin>('/api/admin/carousel'),
  marketRecommendations: () => api.get<MarketInfluenceCandidate[]>('/api/admin/carousel/recommendations'),
  saveCarousel: (items: Array<{ vehicleId: string; isActive: boolean }>) => api.put<CarouselAdmin>('/api/admin/carousel', { items }),

  reports: (status: string) => api.get<Page<AdminReport>>(`/api/admin/reports${qs({ status })}`),
  reportsBoard: (status: string) => api.get<ReportsBoardDTO>(`/api/admin/reports/board${qs({ status })}`),
  reportChat: (id: string) => api.get<ReportChatDTO>(`/api/admin/reports/${id}/chat`),
  decideReport: (id: string, input: ReportDecisionInput) => api.post<{ status: 'RESOLVED' | 'DISMISSED'; result: string; name: string; reports: number }>(`/api/admin/reports/${id}/decision`, input),
  resolveReport: (id: string, input: { status: 'RESOLVED' | 'DISMISSED'; note?: string; archiveVehicle: boolean }) => api.patch<void>(`/api/admin/reports/${id}`, input),
  reviews: (status: string) => api.get<AdminReview[]>(`/api/admin/reviews${qs({ status })}`),
  moderateReview: (id: string, status: 'APPROVED' | 'REJECTED') => api.patch<void>(`/api/admin/reviews/${id}`, { status }),
  blockedTerms: () => api.get<Array<{ id: string; term: string; createdAt: string }>>('/api/admin/blocked-terms'),
  addTerm: (term: string) => api.post<{ id: string; term: string }>('/api/admin/blocked-terms', { term }),
  removeTerm: (id: string) => api.delete(`/api/admin/blocked-terms/${id}`),
  contact: () => api.get<ContactMessage[]>('/api/admin/contact'),
  setContactStatus: (id: string, status: 'NEW' | 'HANDLED') => api.patch<void>(`/api/admin/contact/${id}`, { status }),
};

/** Descarga un .xlsx/.pdf generado por la API (con renovación de sesión si caducó el token). */
export async function downloadExport(dataset: ExportDataset, format: ExportFormat) {
  const url = `${clientApiUrl()}/api/admin/exports/${dataset}?format=${format}`;
  let res = await fetch(url, { credentials: 'include' });
  if (res.status === 401 && (await refreshSession())) res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'EXPORT_FAILED', 'No se pudo generar la exportación.');
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `automarket-${dataset}.${format}`;
  const href = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement('a'), { href, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
