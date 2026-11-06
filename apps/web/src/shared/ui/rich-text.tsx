import { Fragment, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Texto de los Copilotos con un formato mínimo y seguro (nunca se interpreta HTML):
 * **negritas** para cifras y estados, «1. …» para pasos, «- …» para opciones y una línea en
 * blanco entre párrafos. Un texto sin marcas se ve igual que antes: un solo párrafo.
 */

type Chunk = { kind: 'p'; text: string } | { kind: 'ol' | 'ul'; items: string[] };

const STEP = /^\s*\d+[.)]\s+/;
const BULLET = /^\s*[-•]\s+/;

export function parseRichText(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const kind = STEP.test(line) ? 'ol' : BULLET.test(line) ? 'ul' : 'p';
    if (kind === 'p') {
      chunks.push({ kind, text: line.trim() });
      continue;
    }
    const item = line.replace(kind === 'ol' ? STEP : BULLET, '');
    const last = chunks.at(-1);
    if (last && last.kind === kind) last.items.push(item);
    else chunks.push({ kind, items: [item] });
  }
  return chunks;
}

/** «**$18.500**» → <strong>$18.500</strong>; el resto, texto plano. */
function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*\n]+\*\*)/g)
    .filter(Boolean)
    .map((part, i) =>
      part.length > 4 && part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i} className="font-bold">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const chunks = parseRichText(text);
  return (
    <div className={cn('grid gap-1.5', className)}>
      {chunks.map((chunk, i) =>
        chunk.kind === 'p' ? (
          <p key={i}>{inline(chunk.text)}</p>
        ) : chunk.kind === 'ol' ? (
          <ol key={i} className="grid list-decimal gap-1 pl-5 marker:font-bold marker:text-muted">
            {chunk.items.map((item, j) => (
              <li key={j} className="pl-0.5">
                {inline(item)}
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="grid list-disc gap-1 pl-5 marker:text-muted">
            {chunk.items.map((item, j) => (
              <li key={j} className="pl-0.5">
                {inline(item)}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

/** El mismo texto sin marcas (para copiar o leer en voz alta). */
export const plainText = (text: string) => text.replace(/\*\*([^*\n]+)\*\*/g, '$1');
