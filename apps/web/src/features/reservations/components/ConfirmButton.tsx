'use client';

import { useEffect, useState } from 'react';
import { Button, type ButtonProps } from '@/shared/ui/button';

/** Acción irreversible en dos pasos: el primer clic pide confirmación (se anula a los 8 s). */
export function ConfirmButton({ onConfirm, confirmLabel = '¿Confirmar?', children, ...props }: ButtonProps & { onConfirm: () => void; confirmLabel?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 8_000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      {...props}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}
