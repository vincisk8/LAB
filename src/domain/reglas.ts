/**
 * Reglas de validación deterministas. Ninguna depende del modelo de lenguaje.
 */

/** Normaliza texto para comparar etiquetas: minúsculas, sin tildes, sin signos, espacios simples. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[*:]/g, " ")
    .replace(/[^a-z0-9/%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dígito de verificación del NIT colombiano (DIAN, módulo 11). */
export function calcularDvNit(nit: string): string {
  const digitos = nit.replace(/\D/g, "");
  if (!digitos || digitos.length > 15) throw new Error("NIT inválido");
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let suma = 0;
  const inv = digitos.split("").reverse();
  inv.forEach((d, i) => (suma += Number(d) * pesos[i]!));
  const r = suma % 11;
  return String(r > 1 ? 11 - r : r);
}

export const reEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const reTelefono = /^\+\d{1,3}[\d\s-]{7,15}$/;

/** Días calendario entre dos fechas ISO (b - a). */
export function diasEntre(aIso: string, bIso: string): number {
  const a = Date.UTC(+aIso.slice(0, 4), +aIso.slice(5, 7) - 1, +aIso.slice(8, 10));
  const b = Date.UTC(+bIso.slice(0, 4), +bIso.slice(5, 7) - 1, +bIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function sumarDias(iso: string, dias: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + dias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function esFechaIso(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Extrae la vigencia máxima exigida por el cliente a partir del texto libre del requisito.
 * Ejemplos: "no mayor a 30 días", "expedición no superior a 15 días", "no older than 60 days".
 */
export function extraerVigenciaDias(texto: string): number | undefined {
  const t = normalizar(texto);
  const m =
    t.match(/(?:no mayor|no superior|maximo|max|inferior|menor)\s*(?:a|de)?\s*(\d{1,4})\s*dias?/) ??
    t.match(/(?:no older than|within|less than|max)\s*(\d{1,4})\s*days?/) ??
    t.match(/(\d{1,4})\s*dias? de (?:expedicion|vigencia)/);
  return m ? Number(m[1]) : undefined;
}

// ───────────────────────────── Formato ─────────────────────────────

function agrupar(entero: string, sep: string): string {
  return entero.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Formateo numérico propio (no depende de ICU del runtime → mismo resultado en Node y Bun). */
export function formatearNumero(n: number, decimales: number, locale: "es-CO" | "en-US"): string {
  const [miles, dec] = locale === "es-CO" ? [".", ","] : [",", "."];
  const neg = n < 0;
  const fijo = Math.abs(n).toFixed(decimales);
  const [ent, frac] = fijo.split(".");
  return (neg ? "-" : "") + agrupar(ent!, miles) + (frac ? dec + frac : "");
}

export function formatearFecha(iso: string, formato: "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY"): string {
  const [y, m, d] = iso.split("-");
  if (formato === "YYYY-MM-DD") return iso;
  if (formato === "MM/DD/YYYY") return `${m}/${d}/${y}`;
  return `${d}/${m}/${y}`;
}

/** Redondeo bancario-agnóstico a N decimales evitando errores de coma flotante. */
export function redondear(n: number, decimales: number): number {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
}
