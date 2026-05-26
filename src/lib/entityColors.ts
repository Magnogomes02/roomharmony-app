// Helpers para cores cadastradas em rooms.color_hex e professionals.color_hex.
// Mantém fallback determinístico quando não houver cor configurada.

const FALLBACK_PALETTE = [
  "#E8BF2F", // dourado
  "#6F8F72", // verde saúde
  "#7C93A6", // azul acinzentado
  "#D98C5F", // terracota
  "#A68BAE", // lilás
  "#C98686", // rosa queimado
  "#B8941F", // dourado escuro
  "#6B6B6B", // cinza
];

export function isValidHex(v: string | null | undefined): v is string {
  return !!v && /^#[0-9A-Fa-f]{6}$/.test(v);
}

export function fallbackColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

export function entityColor(hex: string | null | undefined, id: string): string {
  return isValidHex(hex) ? hex : fallbackColor(id);
}

// Estilo inline pronto para "badge"/bloco: borda forte + fundo translúcido.
export function colorBlockStyle(hex: string): React.CSSProperties {
  return {
    borderColor: hex,
    backgroundColor: `${hex}22`,
  };
}

// Ordena salas por sort_order asc (nulls last) e depois por nome natural.
export function sortRooms<T extends { name: string; sort_order: number | null }>(rooms: T[]): T[] {
  return [...rooms].sort((a, b) => {
    const sa = a.sort_order;
    const sb = b.sort_order;
    if (sa != null && sb != null && sa !== sb) return sa - sb;
    if (sa != null && sb == null) return -1;
    if (sa == null && sb != null) return 1;
    // fallback: número natural do nome
    const na = parseInt(a.name.match(/\d+/)?.[0] ?? "", 10);
    const nb = parseInt(b.name.match(/\d+/)?.[0] ?? "", 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}
