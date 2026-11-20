/**
 * Mapeo etiqueta del cliente → clave del maestro (HU-2).
 *   1. Coincidencia exacta normalizada con un sinónimo del glosario o con el nombre de una clave → confianza 1.
 *   2. Similitud de tokens (Dice) contra sinónimos y claves → confianza = puntaje.
 *   3. Clasificación: lleno (≥ umbral y con valor) · requiere_confirmacion (< umbral, empate o regla de país) · faltante.
 * Nunca se inventa un valor: si no hay dato en el maestro, el campo es faltante.
 */
import { createHash } from "node:crypto";
import type { EntradaGlosario, Maestro } from "./insumos";
import { rutasHoja, valorEnRuta } from "./insumos";
import { reglas } from "./reglas";
import { normalizar, redondear2, similitud, sinParentesis } from "./texto";

export interface CampoLleno {
  etiqueta: string;
  clave: string;
  ruta: string;
  valor: string;
  confianza: number;
}
export interface CampoFaltante {
  etiqueta: string;
  motivo: string;
  obligatorio: boolean;
}
export interface CampoPorConfirmar {
  etiqueta: string;
  motivo: string;
  nota: string;
  confianza: number;
  propuesta: string | null;
  clave: string | null;
  ruta: string | null;
  /** Valor que se escribe en el formulario (solo reglas de identificador, RN1). Null = se deja en blanco. */
  valor: string | null;
}
export interface Mapeo {
  mapeo_id: string;
  llenos: CampoLleno[];
  faltantes: CampoFaltante[];
  requiere_confirmacion: CampoPorConfirmar[];
}

interface Candidato {
  clave: string;
  confianza: number;
}

export class IndiceMapeo {
  private entradas: { norm: string; texto: string; clave: string; origen: "glosario" | "clave" }[] = [];

  constructor(glosario: EntradaGlosario[], readonly maestro: Maestro, readonly pais: string) {
    for (const g of glosario) this.entradas.push({ norm: normalizar(g.sinonimo), texto: g.sinonimo, clave: g.clave, origen: "glosario" });
    for (const ruta of rutasHoja(maestro)) this.entradas.push({ norm: normalizar(ruta), texto: ruta.replace(/[._]/g, " "), clave: ruta, origen: "clave" });
  }

  /**
   * Devuelve los mejores candidatos (varios si hay empate). Las coincidencias exactas se buscan por
   * prioridad: glosario (etiqueta completa) → glosario (sin paréntesis) → nombre de clave → clave sin paréntesis.
   */
  candidatos(etiqueta: string): Candidato[] {
    const completa = normalizar(etiqueta);
    const corta = normalizar(sinParentesis(etiqueta));
    const niveles: [string, "glosario" | "clave"][] = [[completa, "glosario"], [corta, "glosario"], [completa, "clave"], [corta, "clave"]];
    for (const [v, origen] of niveles) {
      const exactas = [...new Set(this.entradas.filter((e) => e.origen === origen && v && e.norm === v).map((e) => e.clave))];
      if (exactas.length) return exactas.map((clave) => ({ clave, confianza: 1 }));
    }
    const variantes = [...new Set([completa, corta])].filter(Boolean);
    const mejores = new Map<string, number>();
    for (const e of this.entradas) {
      const s = Math.max(...variantes.map((v) => similitud(v, e.texto)));
      if (s > (mejores.get(e.clave) ?? 0)) mejores.set(e.clave, s);
    }
    const orden = [...mejores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const top = orden[0];
    if (!top || top[1] === 0) return [];
    return orden.filter(([, s]) => s === top[1]).map(([clave, s]) => ({ clave, confianza: redondear2(s) }));
  }
}

const ruta = (clave: string) => `repositorio/maestro.json#${clave}`;

function reglaIdentificador(etiqueta: string, clave: string, valor: string, pais: string): CampoPorConfirmar | null {
  if (!reglas.claves_identificador_tributario.includes(clave)) return null;
  const equivalente = reglas.paises[pais]?.identificador_tributario ?? "identificador local";
  const base = { etiqueta, confianza: 1, clave, ruta: ruta(clave), valor };
  if (pais !== reglas.pais_maestro) {
    const dato = clave === "nit" ? "el NIT" : "el dígito de verificación del NIT";
    return { ...base, motivo: "identificador extranjero", propuesta: equivalente, nota: `El cliente (${pais}) pide ${equivalente}; Periferia solo tiene NIT colombiano. Se llenó con ${dato}: confirmar si el cliente lo acepta.` };
  }
  const n = normalizar(etiqueta);
  const ambigua = clave === "nit" && (reglas.etiquetas_identificador_ambiguas.includes(n) || !/\bnit\b/.test(n));
  if (ambigua) return { ...base, motivo: "campo ambiguo", propuesta: equivalente, nota: `"${etiqueta}" es ambiguo; en ${pais} el equivalente es ${equivalente}. Se llenó con el NIT.` };
  return null;
}

type Resultado = { tipo: "lleno"; c: CampoLleno } | { tipo: "faltante"; c: CampoFaltante } | { tipo: "confirmar"; c: CampoPorConfirmar };

export function mapearCampo(etiqueta: string, obligatorio: boolean, idx: IndiceMapeo): Resultado {
  const cands = idx.candidatos(etiqueta);
  const mejor = cands[0];
  if (!mejor || mejor.confianza < reglas.umbral_minimo) {
    return { tipo: "faltante", c: { etiqueta, obligatorio, motivo: "No existe un dato equivalente en el repositorio maestro." } };
  }
  if (cands.length > 1) {
    return { tipo: "confirmar", c: { etiqueta, motivo: "mapeo ambiguo", nota: `Coincide igual con: ${cands.map((c) => c.clave).join(", ")}.`, confianza: mejor.confianza, propuesta: null, clave: null, ruta: null, valor: null } };
  }
  const valor = valorEnRuta(idx.maestro, mejor.clave);
  if (valor === null) {
    return { tipo: "faltante", c: { etiqueta, obligatorio, motivo: `La clave "${mejor.clave}" no tiene valor en el repositorio maestro.` } };
  }
  if (mejor.confianza < reglas.umbral_confianza) {
    return {
      tipo: "confirmar",
      c: { etiqueta, motivo: "confianza baja", nota: `Posible equivalente "${mejor.clave}" (confianza ${mejor.confianza}). No se llenó: confirmar antes de usarlo.`, confianza: mejor.confianza, propuesta: mejor.clave, clave: mejor.clave, ruta: ruta(mejor.clave), valor: null },
    };
  }
  const pais = reglaIdentificador(etiqueta, mejor.clave, valor, idx.pais);
  if (pais) return { tipo: "confirmar", c: pais };
  return { tipo: "lleno", c: { etiqueta, clave: mejor.clave, ruta: ruta(mejor.clave), valor, confianza: mejor.confianza } };
}

export function mapear(caso: string, campos: { etiqueta: string; obligatorio: boolean }[], idx: IndiceMapeo): Mapeo {
  const m: Omit<Mapeo, "mapeo_id"> = { llenos: [], faltantes: [], requiere_confirmacion: [] };
  for (const campo of campos) {
    const r = mapearCampo(campo.etiqueta, campo.obligatorio, idx);
    if (r.tipo === "lleno") m.llenos.push(r.c);
    else if (r.tipo === "faltante") m.faltantes.push(r.c);
    else m.requiere_confirmacion.push(r.c);
  }
  const huella = createHash("sha256").update(JSON.stringify(m)).digest("hex").slice(0, 10);
  return { mapeo_id: `MAP-${caso}-${huella}`, ...m };
}

/** Valor que se escribe en el formulario para una etiqueta (lleno o regla de identificador). */
export function valorParaFormulario(m: Mapeo, etiqueta: string): { valor: string | null; estado: "lleno" | "requiere_confirmacion" | "faltante" } {
  const lleno = m.llenos.find((c) => c.etiqueta === etiqueta);
  if (lleno) return { valor: lleno.valor, estado: "lleno" };
  const conf = m.requiere_confirmacion.find((c) => c.etiqueta === etiqueta);
  if (conf) return { valor: conf.valor, estado: "requiere_confirmacion" };
  return { valor: null, estado: "faltante" };
}
