import type { CatalogBrandDTO, SaleCommissionCheckoutInput, SavedVehicleDTO, SearchResultDTO, SmartSearchDTO, SmartSearchStartDTO, VehicleCardDTO, VehicleDetailDTO, VehicleDraftInput, VehicleInsightsDTO, VehicleInsightsQuery, VehicleMediaDTO, VehicleSaleCheckoutDTO, VehicleUpdateInput } from '@automarket/contracts';
import { api } from '@/shared/lib/http';
import type { PresignedUpload } from '@/shared/lib/upload';

export interface VehicleLocation {
  latitude: number;
  longitude: number;
}

export interface Facets {
  makes: Array<{ value: string; count: number }>;
  models: Array<{ value: string; count: number }>;
  cities: Array<{ value: string; count: number }>;
  /** Precio más alto publicado (tope del deslizador de precio). */
  priceMax: number | null;
}

export type MyListing = VehicleCardDTO & { expiresAt: string | null; publishedAt: string | null; featuredUntil: string | null; mediaCount: number; pendingSalePaymentId: string | null };
export interface MyListings {
  items: MyListing[];
  usage: { active: number; slotsUsed: number; max: number | null; planCode: string; commissionRate: number; featuredSlots: number; monthlyFeaturedCredits: number; featureCreditMonth: string | null };
}

export const vehicleKeys = {
  all: ['vehicles'] as const,
  search: (query: string) => ['vehicles', 'search', query] as const,
  smart: (q: string, limit: number) => ['vehicles', 'smart', q, limit] as const,
  smartStart: ['vehicles', 'smart', 'start'] as const,
  facets: (make: string, country: string) => ['vehicles', 'facets', make, country] as const,
  detail: (slug: string) => ['vehicles', 'detail', slug] as const,
  similar: (slug: string) => ['vehicles', 'similar', slug] as const,
  edit: (id: string) => ['vehicles', 'edit', id] as const,
  mine: ['vehicles', 'mine'] as const,
  recommended: ['vehicles', 'recommended'] as const,
  brands: ['catalog', 'brands'] as const,
  insights: (query: VehicleInsightsQuery) => ['vehicles', 'insights', query] as const,
  watching: ['vehicles', 'watching'] as const,
  savedIds: ['vehicles', 'saved', 'ids'] as const,
  saved: ['vehicles', 'saved', 'list'] as const,
};

/** Cliente del catálogo y de la publicación de anuncios. */
export const vehiclesApi = {
  search: (query: string, signal?: AbortSignal, location?: VehicleLocation | null) =>
    api.get<SearchResultDTO>(`/api/vehicles${query ? `?${query}` : ''}`, signal, location ? {
      'X-Location-Latitude': String(location.latitude),
      'X-Location-Longitude': String(location.longitude),
    } : undefined),
  facets: (make: string, country: string) => api.get<Facets>(`/api/vehicles/facets?${new URLSearchParams({ ...(make && { make }), ...(country && { country }) })}`),
  recommended: () => api.get<VehicleCardDTO[]>('/api/vehicles/recommended'),
  /** Buscador inteligente (frase libre → filtros, sugerencias y los mejores autos). */
  smart: (q: string, limit: number, signal?: AbortSignal) => api.get<SmartSearchDTO>(`/api/vehicles/smart?${new URLSearchParams({ q, limit: String(limit) })}`, signal),
  smartStart: () => api.get<SmartSearchStartDTO>('/api/vehicles/smart/start'),
  /** Marcas y modelos activos del catálogo que mantiene el administrador. */
  brands: () => api.get<CatalogBrandDTO[]>('/api/public/catalog/brands'),
  bySlug: (slug: string) => api.get<VehicleDetailDTO>(`/api/vehicles/${encodeURIComponent(slug)}`),
  similar: (slug: string) => api.get<VehicleCardDTO[]>(`/api/vehicles/${encodeURIComponent(slug)}/similar`),
  report: (id: string, input: { reason: string; details?: string }) => api.post<{ message: string }>(`/api/vehicles/${id}/report`, input),
  /** «Avísame si vuelve» para autos en negociación. */
  watching: () => api.get<string[]>('/api/vehicles/watching'),
  watch: (id: string) => api.put<void>(`/api/vehicles/${id}/watch`, {}),
  unwatch: (id: string) => api.delete(`/api/vehicles/${id}/watch`),
  /** «Guardar» en la ficha. */
  savedIds: () => api.get<string[]>('/api/vehicles/saved/ids'),
  saved: () => api.get<SavedVehicleDTO[]>('/api/vehicles/saved'),
  save: (id: string) => api.put<void>(`/api/vehicles/${id}/save`, {}),
  unsave: (id: string) => api.delete(`/api/vehicles/${id}/save`),

  mine: () => api.get<MyListings>('/api/vehicles/mine'),
  /** Copiloto: ficha típica y valor de mercado con anuncios reales de AutoMarket. */
  insights: (query: VehicleInsightsQuery) =>
    api.get<VehicleInsightsDTO>(`/api/vehicles/insights?${new URLSearchParams(Object.entries(query).flatMap(([key, value]) => (value === undefined || value === '' ? [] : [[key, String(value)]])))}`),
  forEdit: (id: string) => api.get<VehicleDetailDTO>(`/api/vehicles/${id}/edit`),
  create: (input: VehicleDraftInput) => api.post<{ id: string; slug: string; status: string }>('/api/vehicles', input),
  update: (id: string, input: VehicleUpdateInput) => api.patch<{ id: string; slug: string; status: string }>(`/api/vehicles/${id}`, input),
  publish: (id: string) => api.post<{ id: string; slug: string; status: string; expiresAt: string | null }>(`/api/vehicles/${id}/publish`),
  pause: (id: string) => api.post<void>(`/api/vehicles/${id}/pause`),
  feature: (id: string) => api.post<void>(`/api/vehicles/${id}/feature`),
  unfeature: (id: string) => api.delete(`/api/vehicles/${id}/feature`),
  archive: (id: string) => api.delete(`/api/vehicles/${id}`),
  markSold: (id: string, input: SaleCommissionCheckoutInput) => api.post<VehicleSaleCheckoutDTO>(`/api/vehicles/${id}/sale/checkout`, input),

  presignMedia: (id: string, file: File) => api.post<PresignedUpload & { kind: 'IMAGE' | 'VIDEO' }>(`/api/vehicles/${id}/media/uploads`, { mimeType: file.type, sizeBytes: file.size }),
  registerMedia: (id: string, input: { key: string; width?: number; height?: number; durationMs?: number }) => api.post<VehicleMediaDTO>(`/api/vehicles/${id}/media`, input),
  removeMedia: (id: string, mediaId: string) => api.delete(`/api/vehicles/${id}/media/${mediaId}`),
  reorderMedia: (id: string, mediaIds: string[]) => api.put<void>(`/api/vehicles/${id}/media/order`, { mediaIds }),
};
