import { Fragment, type ReactNode } from 'react';

type Block = { kind: 'h1' | 'h2' | 'p'; text: string } | { kind: 'list'; items: string[] };

/** «# Título», «## Sección», «- elemento» y párrafos separados por líneas en blanco. */
function parse(content: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith('## ')) {
      flush();
      blocks.push({ kind: 'h2', text: line.slice(3) });
    } else if (line.startsWith('# ')) {
      flush();
      blocks.push({ kind: 'h1', text: line.slice(2) });
    } else if (line.startsWith('- ')) {
      flush();
      const last = blocks.at(-1);
      if (last?.kind === 'list') last.items.push(line.slice(2));
      else blocks.push({ kind: 'list', items: [line.slice(2)] });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/** «**negrita**» dentro de una línea. React escapa el resto: nunca se inyecta HTML. */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>,
  );
}

/** Términos y Condiciones editados desde el panel (formato de texto simple, sin HTML). */
export function TermsContent({ content }: { content: string }) {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-ink/90">
      {parse(content).map((block, index) => {
        if (block.kind === 'h1') return <h1 key={index} className="font-display text-3xl tracking-tight text-ink">{inline(block.text)}</h1>;
        if (block.kind === 'h2') return <h2 key={index} className="pt-4 font-display text-lg text-ink">{inline(block.text)}</h2>;
        if (block.kind === 'list') {
          return (
            <ul key={index} className="list-disc space-y-1.5 pl-5">
              {block.items.map((item, i) => (
                <li key={i}>{inline(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{inline(block.text)}</p>;
      })}
    </div>
  );
}
