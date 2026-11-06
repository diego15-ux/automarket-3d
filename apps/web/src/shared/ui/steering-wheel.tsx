/** Volante: el ícono del Copiloto (en lugar de chispas o robots). Acepta las mismas props que los íconos de lucide. */
export function SteeringWheel({ className, strokeWidth = 2 }: { className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 14.2V21M9.9 11.4 3.4 9.6M14.1 11.4l6.5-1.8" />
    </svg>
  );
}
