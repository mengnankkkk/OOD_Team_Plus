const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
};

export function sanitizeRssText(value: unknown): string {
  const raw = textFrom(value);
  if (!raw) return "";
  return decodeHtmlEntities(raw)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function textFrom(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const object = value as Record<string, unknown>;
  return textFrom(object["#text"] ?? object.name ?? "");
}

function decodeHtmlEntities(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/giu, (entity, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) return codePoint(body.slice(2), 16) ?? entity;
      if (body.startsWith("#")) return codePoint(body.slice(1), 10) ?? entity;
      return HTML_ENTITIES[body.toLowerCase()] ?? entity;
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function codePoint(value: string, radix: number): string | null {
  const point = Number.parseInt(value, radix);
  return Number.isFinite(point) ? String.fromCodePoint(point) : null;
}
