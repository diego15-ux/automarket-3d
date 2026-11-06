'use client';

import { useMutation } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/shared/ui/button';
import { useToast } from '@/shared/ui/toaster';
import { chatApi } from '../api';

export function ContactSellerButton({
  vehicleId,
  className,
  label = 'Contactar al vendedor',
  variant = 'outline',
}: {
  vehicleId: string;
  className?: string;
  label?: string;
  variant?: 'outline' | 'gold';
}) {
  const router = useRouter();
  const toast = useToast();
  const open = useMutation({
    mutationFn: () => chatApi.open(vehicleId),
    onSuccess: ({ id }) => router.push(`/mensajes/${id}`),
    onError: error => toast({ tone: 'error', title: 'No se pudo abrir el chat', description: error.message }),
  });

  return (
    <Button variant={variant} className={className ?? 'w-full'} onClick={() => open.mutate()} loading={open.isPending}>
      {!open.isPending && <MessageCircle className="size-[17px]" />} {label}
    </Button>
  );
}
