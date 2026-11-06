/** Une clases condicionales: cn('a', cond && 'b') → 'a b'. */
export const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');
