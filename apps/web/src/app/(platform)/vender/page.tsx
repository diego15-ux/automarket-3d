import { redirect } from 'next/navigation';

/** Atajo público: /vender → asistente de publicación. */
export default function SellPage() {
  redirect('/cuenta/anuncios/nuevo');
}
