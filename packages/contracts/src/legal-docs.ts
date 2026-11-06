/**
 * Términos y políticas editables desde el panel, en texto simple (sin HTML):
 *   «# Título» abre un documento · el texto antes del primer «##» es su introducción ·
 *   «## Sección» (se numeran solas; un «1.» escrito a mano se quita) · párrafos y listas «- ».
 */
export interface LegalBlock {
  kind: 'p' | 'li';
  text: string;
}
export interface LegalSection {
  heading: string;
  blocks: LegalBlock[];
}
export interface LegalDoc {
  key: string;
  title: string;
  intro: LegalBlock[];
  sections: LegalSection[];
  /** Documento de cookies: lleva el panel de preferencias. */
  cookies: boolean;
}

const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'documento';

export function parseLegalDocs(content: string): LegalDoc[] {
  const docs: LegalDoc[] = [];
  let paragraph: string[] = [];
  const current = () => {
    if (docs.length === 0) docs.push({ key: '', title: 'Términos y condiciones', intro: [], sections: [], cookies: false });
    return docs[docs.length - 1]!;
  };
  const push = (block: LegalBlock) => {
    const doc = current();
    const section = doc.sections.at(-1);
    (section ? section.blocks : doc.intro).push(block);
  };
  const flush = () => {
    if (paragraph.length) push({ kind: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (/^#\s/.test(line)) {
      flush();
      const title = line.replace(/^#\s+/, '');
      docs.push({ key: '', title, intro: [], sections: [], cookies: /cookie/i.test(title) });
    } else if (/^#{2,3}\s/.test(line)) {
      flush();
      current().sections.push({ heading: line.replace(/^#{2,3}\s+/, '').replace(/^\d+[.)]\s*/, ''), blocks: [] });
    } else if (line.startsWith('- ')) {
      flush();
      push({ kind: 'li', text: line.slice(2) });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  const used = new Set<string>();
  for (const doc of docs) {
    let key = doc.cookies ? 'cookies' : slug(doc.title);
    for (let n = 2; used.has(key); n++) key = `${slug(doc.title)}-${n}`;
    used.add(key);
    doc.key = key;
  }
  return docs.filter(doc => doc.intro.length > 0 || doc.sections.length > 0);
}

/** Texto de búsqueda: sin acentos, minúsculas y sin espacios al borde. */
export const normalizeSearch = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export const sectionText = (section: LegalSection) => normalizeSearch([section.heading, ...section.blocks.map(block => block.text)].join(' ').replace(/\*\*/g, ''));
