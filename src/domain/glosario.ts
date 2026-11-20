/**
 * Mapeo determinista de etiquetas del cliente → claves maestras, usando el glosario de sinónimos.
 *
 * Estrategia (en orden):
 *   1. Coincidencia exacta normalizada (etiqueta completa o sin el texto entre paréntesis)  → confianza 1.00
 *   2. Coincidencia por conjunto de tokens (coeficiente de Dice, sin palabras vacías) ≥ 0.75 → confianza = score
 *   3. Sin mapeo → se reportan hasta 3 candidatos y el campo queda para decisión humana.
 * Un empate entre claves distintas con el mismo puntaje se trata como ambiguo (no se adivina).
 */
import { normalizar } from "./reglas";
import type { Glosario } from "./tipos";

const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "y", "o", "para", "of", "the", "and", "a", "en", "/", "n", "no"]);
export const UMBRAL_APROXIMADO = 0.75;

export interface ResultadoMapeo {
  etiqueta: string;
  clave: string | null;
  confianza: number;
  metodo: "exacto" | "aproximado" | "sin_mapeo" | "ambiguo";
  sinonimo?: string;
  candidatos?: { clave: string; score: number }[];
}

function tokens(s: string): Set<string> {
  return new Set(s.split(" ").filter((t) => t && !VACIAS.has(t)));
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return (2 * inter) / (a.size + b.size);
}

function sinParentesis(s: string) {
  return s.replace(/\([^)]*\)/g, " ");
}

type Indice = { clave: string; sinonimo: string; norm: string; toks: Set<string> }[];

export function construirIndice(diccionario: Record<string, string[]>): Indice {
  const idx: Indice = [];
  for (const [clave, sins] of Object.entries(diccionario)) {
    for (const s of [clave.replace(/_/g, " "), ...sins]) {
      const norm = normalizar(s);
      idx.push({ clave, sinonimo: s, norm, toks: tokens(norm) });
    }
  }
  return idx;
}

export function mapearEtiqueta(etiqueta: string, indice: Indice): ResultadoMapeo {
  const variantes = [...new Set([normalizar(etiqueta), normalizar(sinParentesis(etiqueta))])].filter(Boolean);

  for (const v of variantes) {
    const exactos = [...new Set(indice.filter((e) => e.norm === v).map((e) => e.clave))];
    if (exactos.length === 1) {
      const e = indice.find((x) => x.norm === v)!;
      return { etiqueta, clave: e.clave, confianza: 1, metodo: "exacto", sinonimo: e.sinonimo };
    }
    if (exactos.length > 1) {
      return { etiqueta, clave: null, confianza: 0, metodo: "ambiguo", candidatos: exactos.map((c) => ({ clave: c, score: 1 })) };
    }
  }

  // Aproximado: mejor score por clave
  const mejores = new Map<string, { score: number; sinonimo: string }>();
  for (const v of variantes) {
    const tv = tokens(v);
    for (const e of indice) {
      const s = dice(tv, e.toks);
      const prev = mejores.get(e.clave);
      if (!prev || s > prev.score) mejores.set(e.clave, { score: s, sinonimo: e.sinonimo });
    }
  }
  const orden = [...mejores.entries()].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]));
  const candidatos = orden.slice(0, 3).filter(([, m]) => m.score > 0).map(([clave, m]) => ({ clave, score: Math.round(m.score * 100) / 100 }));
  const [primero, segundo] = orden;
  if (primero && primero[1].score >= UMBRAL_APROXIMADO) {
    if (segundo && segundo[1].score === primero[1].score) {
      return { etiqueta, clave: null, confianza: 0, metodo: "ambiguo", candidatos };
    }
    return { etiqueta, clave: primero[0], confianza: Math.round(primero[1].score * 100) / 100, metodo: "aproximado", sinonimo: primero[1].sinonimo, candidatos };
  }
  return { etiqueta, clave: null, confianza: 0, metodo: "sin_mapeo", candidatos };
}

export function mapearSoporte(descripcion: string, glosario: Glosario): { tipo: string | null; sinonimo?: string } {
  const d = ` ${normalizar(descripcion)} `;
  let mejor: { tipo: string; sinonimo: string; largo: number } | null = null;
  for (const [tipo, sins] of Object.entries(glosario.soportes)) {
    for (const s of sins) {
      const n = normalizar(s);
      if (d.includes(` ${n} `) && (!mejor || n.length > mejor.largo)) mejor = { tipo, sinonimo: s, largo: n.length };
    }
  }
  return mejor ? { tipo: mejor.tipo, sinonimo: mejor.sinonimo } : { tipo: null };
}
