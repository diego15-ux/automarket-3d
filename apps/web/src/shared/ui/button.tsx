import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';
import { Spinner } from './spinner';

/**
 * Botones de los diseños: píldoras con texto en negrita.
 * primary: la acción principal (verde sobrio en los dos modos). outline / ghost: secundarias.
 * gold: acción fuerte en tinta. danger: acciones que borran o retiran.
 */
type Variant = 'primary' | 'outline' | 'ghost' | 'gold' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-600',
  outline: 'border border-edge bg-surface text-ink hover:border-ink',
  ghost: 'text-ink hover:bg-ink/[0.06]',
  gold: 'bg-ink text-canvas hover:bg-ink/85',
  danger: 'border border-danger/45 bg-surface text-danger-fg hover:border-danger hover:bg-danger-soft',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-4 text-[13px]',
  md: 'h-11 px-5 text-sm',
  lg: 'h-12 px-6 text-[15px]',
  icon: 'size-10 text-sm',
};

export interface ButtonStyleProps {
  variant?: Variant;
  size?: Size;
  className?: string;
}

/** Clases de botón reutilizables también en <Link>. */
export const buttonClasses = ({ variant = 'primary', size = 'md', className }: ButtonStyleProps = {}) =>
  cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-bold whitespace-nowrap transition-colors duration-150',
    'disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
    VARIANTS[variant],
    SIZES[size],
    className,
  );

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {
  loading?: boolean;
}

export function Button({ variant, size, loading = false, className, children, disabled, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={buttonClasses({ variant, size, className })} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}
