/** Utilidades de texto deterministas (sin dependencias). */

/** Minúsculas, sin tildes, sin signos; espacios simples. "Razón Social *" → "razon social". */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Cámara de Comercio" → "camara_comercio" (sin palabras vacías). */
export function slug(texto: string): string {
  return tokens(texto).join("_");
}

const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "y", "o", "para", "of", "the", "and", "a", "en", "e"]);

export function tokens(texto: string): string[] {
  return normalizar(texto)
    .split(" ")
    .filter((t) => t && !VACIAS.has(t));
}

/** Palabras demasiado genéricas para decidir un mapeo por similitud ("Código SWIFT" ≠ "Código CIIU"). */
const GENERICAS = new Set(["codigo", "numero", "nro", "no", "nombre", "tipo", "datos", "dato", "informacion", "fecha"]);

/** Coeficiente de Dice sobre conjuntos de tokens significativos: 1 = idénticos, 0 = sin palabras en común. */
export function similitud(a: string, b: string): number {
  const ta = new Set(tokens(a).filter((t) => !GENERICAS.has(t)));
  const tb = new Set(tokens(b).filter((t) => !GENERICAS.has(t)));
  if (ta.size === 0 || tb.size === 0) return 0;
  let comunes = 0;
  for (const t of ta) if (tb.has(t)) comunes++;
  return (2 * comunes) / (ta.size + tb.size);
}

export function sinParentesis(texto: string): string {
  return texto.replace(/\([^)]*\)/g, " ").trim();
}

export function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}
