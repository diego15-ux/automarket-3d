import type { VehicleCategory } from '@automarket/contracts';

/** Siluetas del diseño (viewBox 330 × 140) para anuncios sin foto. */
const SHAPES = {
  sedan: {
    body: 'M20 100c0-12 8-18 22-20l46-7c14-16 36-28 64-30h56c20 0 38 10 56 28l30 6c14 3 20 10 20 22v6c0 4-3 6-7 6h-19a28 28 0 0 0-54 0H107a28 28 0 0 0-54 0H27c-4 0-7-2-7-6z',
    glass: ['M100 73c12-14 28-22 50-23h18v23z', 'M176 50h28c18 0 32 8 46 22l-74 1z'],
    wheels: [80, 261],
  },
  suv: {
    body: 'M18 98c0-12 6-18 18-20l34-6 28-34c4-5 10-8 18-8h120c10 0 16 4 20 12l16 30 28 5c12 2 18 9 18 21v7c0 4-3 6-7 6h-17a28 28 0 0 0-54 0H107a28 28 0 0 0-54 0H25c-4 0-7-2-7-6z',
    glass: ['M84 72l22-27c3-4 7-6 12-6h46v33z', 'M172 39h58c6 0 10 3 13 8l14 25h-85z'],
    wheels: [80, 267],
  },
  pickup: {
    body: 'M16 98c0-12 6-18 18-20l36-6 26-30c4-5 9-7 16-7h66c8 0 12 3 14 9l10 28h116c6 0 10 4 10 10v23c0 4-3 6-7 6h-15a28 28 0 0 0-54 0H105a28 28 0 0 0-54 0H23c-4 0-7-2-7-6z',
    glass: ['M84 72l20-25c3-4 7-5 11-5h27v30z', 'M150 42h24c5 0 8 2 10 6l9 24h-43z'],
    wheels: [78, 279],
  },
};

const shapeOf = (category: VehicleCategory) => (category === 'PICKUP' ? SHAPES.pickup : category === 'SUV' ? SHAPES.suv : SHAPES.sedan);

export function CarSilhouette({ category, color = '#6B7F8F', glass = true, className }: { category: VehicleCategory; color?: string; glass?: boolean; className?: string }) {
  const shape = shapeOf(category);
  return (
    <svg viewBox="0 0 330 140" aria-hidden className={className}>
      <path d={shape.body} fill={color} />
      {glass && shape.glass.map(d => <path key={d} d={d} fill="#A9B0B8" />)}
      {shape.wheels.map(cx => (
        <circle key={cx} cx={cx} cy={111} r={23} fill="#16181b" />
      ))}
    </svg>
  );
}
