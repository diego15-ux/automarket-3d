import type { Metadata } from 'next';
import { SmartSearchScreen } from '@/features/vehicles/components/SmartSearchScreen';

export const metadata: Metadata = { title: 'Buscar' };

/** Buscador inteligente a pantalla completa (teléfono); en PC el mismo motor vive en la cabecera. */
export default function SearchPage() {
  return <SmartSearchScreen />;
}
