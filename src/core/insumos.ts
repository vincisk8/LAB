/**
 * Lectura tolerante de los fixtures (PRD §7.1 y §7.2). Acepta pequeñas variaciones de forma
 * (lista directa o envuelta en un objeto) y falla con mensajes claros en español.
 * Todas las rutas se resuelven desde ctx.directory; nunca se sale de fixtures/.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { reglas } from "./reglas";
import { normalizar } from "./texto";

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type Formato = "xlsx" | "pdf" | "portal";

export class ErrorInsumo extends Error {}

export const RE_CASO = /^[a-z0-9][a-z0-9-]{1,80}$/;

export function rutaFixtures(directory: string): string {
  return resolve(directory, "fixtures", "reto-01");
}

export function rutaOut(directory: string, ...partes: string[]): string {
  return resolve(directory, "out", ...partes);
}

/** Ruta relativa a la raíz del proyecto, con "/" (para mostrar al usuario y al modelo). */
export function relativa(directory: string, ruta: string): string {
  return relative(directory, ruta).split(sep).join("/");
}

function dirCaso(directory: string, caso: string): string {
  if (!RE_CASO.test(caso)) throw new ErrorInsumo(`El nombre de caso "${caso}" no es válido (solo minúsculas, números y guiones).`);
  const dir = join(rutaFixtures(directory), "casos", caso);
  if (!existsSync(join(dir, "solicitud.json"))) throw new ErrorInsumo(`El caso "${caso}" no existe en fixtures/reto-01/casos/.`);
  return dir;
}

async function leerJson(ruta: string, nombre: string): Promise<Json> {
  let texto: string;
  try {
    texto = await readFile(ruta, "utf8");
  } catch {
    throw new ErrorInsumo(`No se encontró ${nombre}.`);
  }
  try {
    return JSON.parse(texto) as Json;
  } catch (e) {
    throw new ErrorInsumo(`${nombre} está corrupto (JSON inválido: ${(e as Error).message}).`);
  }
}

/** Si el JSON es un objeto que envuelve la lista (p. ej. {campos:[...]}), devuelve la lista. */
function lista(valor: Json, claves: string[]): Json {
  if (Array.isArray(valor) || valor === null || typeof valor !== "object") return valor;
  for (const k of claves) if (Array.isArray(valor[k])) return valor[k];
  return valor;
}

function validar<T>(esquema: z.ZodType<T>, valor: Json, nombre: string): T {
  const r = esquema.safeParse(valor);
  if (r.success) return r.data;
  const detalle = r.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ");
  throw new ErrorInsumo(`${nombre} no tiene la estructura esperada (${detalle}).`);
}

// ───────────────────────────── Solicitud ─────────────────────────────

const EsquemaSolicitud = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  pais: z.string(),
  cliente: z.string(),
  cuerpo: z.string().default(""),
  formato: z.string(),
  adjuntos: z.array(z.string()).default([]),
});

export interface Solicitud {
  id: string;
  de: string;
  asunto: string;
  fecha: string;
  pais: string;
  pais_nombre: string;
  cliente: string;
  cuerpo: string;
  formato: Formato | string;
  adjuntos: string[];
}

export function normalizarPais(pais: string): string {
  const p = pais.trim().toUpperCase();
  if (reglas.paises[p]) return p;
  const porNombre = Object.entries(reglas.paises).find(([, v]) => normalizar(v.nombre) === normalizar(pais));
  return porNombre ? porNombre[0] : p;
}

export function normalizarFormato(formato: string): Formato | string {
  const f = normalizar(formato);
  if (["xlsx", "xls", "excel"].includes(f)) return "xlsx";
  if (f === "pdf") return "pdf";
  if (["portal", "portal web", "web"].includes(f)) return "portal";
  return formato;
}

export async function leerSolicitud(directory: string, caso: string): Promise<Solicitud> {
  const dir = dirCaso(directory, caso);
  const s = validar(EsquemaSolicitud, await leerJson(join(dir, "solicitud.json"), "solicitud.json"), "solicitud.json");
  const pais = normalizarPais(s.pais);
  return {
    ...s,
    id: String(s.id ?? caso),
    pais,
    pais_nombre: reglas.paises[pais]?.nombre ?? s.pais,
    formato: normalizarFormato(s.formato),
  };
}

// ───────────────────────────── Plantillas ─────────────────────────────

const EsquemaCelda = z.object({ hoja: z.string().min(1), celda_etiqueta: z.string().regex(/^[A-Za-z]{1,3}\d{1,6}$/), etiqueta: z.string().min(1), celda_valor: z.string().regex(/^[A-Za-z]{1,3}\d{1,6}$/) });
const EsquemaCampo = z.object({ etiqueta: z.string().min(1), obligatorio: z.boolean().default(true) });

export interface CampoPlantilla {
  etiqueta: string;
  obligatorio: boolean;
  hoja?: string;
  celda_etiqueta?: string;
  celda_valor?: string;
}

/** Lee la plantilla del caso según existan plantilla-celdas.json (xlsx) o plantilla-campos.json (pdf/portal). */
export async function leerPlantilla(directory: string, caso: string): Promise<{ archivo: string; campos: CampoPlantilla[] }> {
  const dir = dirCaso(directory, caso);
  if (existsSync(join(dir, "plantilla-celdas.json"))) {
    const crudo = lista(await leerJson(join(dir, "plantilla-celdas.json"), "plantilla-celdas.json"), ["celdas", "campos"]);
    const celdas = validar(z.array(EsquemaCelda).min(1), crudo, "plantilla-celdas.json");
    return { archivo: "plantilla-celdas.json", campos: celdas.map((c) => ({ ...c, obligatorio: true, celda_etiqueta: c.celda_etiqueta.toUpperCase(), celda_valor: c.celda_valor.toUpperCase() })) };
  }
  if (existsSync(join(dir, "plantilla-campos.json"))) {
    const crudo = lista(await leerJson(join(dir, "plantilla-campos.json"), "plantilla-campos.json"), ["campos"]);
    return { archivo: "plantilla-campos.json", campos: validar(z.array(EsquemaCampo).min(1), crudo, "plantilla-campos.json") };
  }
  throw new ErrorInsumo(`El caso "${caso}" no tiene plantilla-celdas.json ni plantilla-campos.json.`);
}

/** Plantilla Excel original del cliente si viene entre los adjuntos (opcional). */
export function rutaPlantillaXlsx(directory: string, caso: string, adjuntos: string[]): string | null {
  const dir = dirCaso(directory, caso);
  const xlsx = adjuntos.find((a) => /\.xlsx$/i.test(a) && !a.includes("/") && !a.includes("\\"));
  return xlsx && existsSync(join(dir, xlsx)) ? join(dir, xlsx) : null;
}

export async function leerSoportesExigidos(directory: string, caso: string): Promise<string[]> {
  const dir = dirCaso(directory, caso);
  const crudo = lista(await leerJson(join(dir, "soportes-exigidos.json"), "soportes-exigidos.json"), ["soportes", "soportes_exigidos", "tipos"]);
  const items = validar(z.array(z.union([z.string(), z.object({ tipo: z.string() })])), crudo, "soportes-exigidos.json");
  return items.map((i) => (typeof i === "string" ? i : i.tipo));
}

export async function listarCasos(directory: string): Promise<string[]> {
  const entradas = await readdir(join(rutaFixtures(directory), "casos"), { withFileTypes: true });
  return entradas.filter((e) => e.isDirectory() && RE_CASO.test(e.name)).map((e) => e.name).sort();
}

// ───────────────────────────── Repositorio maestro ─────────────────────────────

export type Maestro = { [k: string]: Json };

export async function leerMaestro(directory: string): Promise<Maestro> {
  const m = await leerJson(join(rutaFixtures(directory), "repositorio", "maestro.json"), "repositorio/maestro.json");
  if (m === null || typeof m !== "object" || Array.isArray(m)) throw new ErrorInsumo("repositorio/maestro.json debe ser un objeto.");
  return m;
}

/** Valor hoja (texto) en una ruta con puntos: "representante_legal.nombre". */
export function valorEnRuta(maestro: Maestro, ruta: string): string | null {
  let actual: Json = maestro;
  for (const parte of ruta.split(".")) {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return null;
    actual = actual[parte] ?? null;
  }
  if (actual === null) return null;
  if (typeof actual === "string") return actual.trim() === "" ? null : actual;
  if (typeof actual === "number" || typeof actual === "boolean") return String(actual);
  if (Array.isArray(actual) && actual.every((x) => typeof x === "string" || typeof x === "number")) return actual.join(", ");
  return null;
}

/** Todas las rutas hoja del maestro ("banco.numero_cuenta", …). */
export function rutasHoja(maestro: Maestro, prefijo = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(maestro)) {
    const ruta = prefijo ? `${prefijo}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) out.push(...rutasHoja(v, ruta));
    else out.push(ruta);
  }
  return out;
}

// ───────────────────────────── Soportes ─────────────────────────────

const EsquemaSoporte = z.object({
  tipo: z.string(),
  archivo: z.string(),
  vigencia_hasta: z.string().nullable().optional(),
  pais_emisor: z.string().optional(),
});
export type SoporteIndice = z.infer<typeof EsquemaSoporte>;

export function rutaSoportes(directory: string): string {
  return join(rutaFixtures(directory), "repositorio", "soportes");
}

export async function leerIndiceSoportes(directory: string): Promise<SoporteIndice[]> {
  const crudo = lista(await leerJson(join(rutaSoportes(directory), "index.json"), "repositorio/soportes/index.json"), ["soportes"]);
  return validar(z.array(EsquemaSoporte), crudo, "repositorio/soportes/index.json");
}

// ───────────────────────────── Glosario ─────────────────────────────

export interface EntradaGlosario {
  sinonimo: string;
  clave: string;
}

/**
 * Acepta las tres formas habituales del glosario:
 *   { "Razón social": "razon_social" }            (sinónimo → clave)
 *   { "razon_social": ["Razón social", …] }        (clave → sinónimos)
 *   [ { "sinonimo"|"etiqueta": "…", "clave": "…" } ]
 */
export async function leerGlosario(directory: string, maestro: Maestro): Promise<EntradaGlosario[]> {
  const crudo = await leerJson(join(rutaFixtures(directory), "glosario-campos.json"), "glosario-campos.json");
  const rutas = new Set(rutasHoja(maestro));
  const datos = lista(crudo, ["sinonimos", "glosario", "campos"]);
  if (Array.isArray(datos)) {
    const items = validar(z.array(z.object({ clave: z.string(), sinonimo: z.string().optional(), etiqueta: z.string().optional() })), datos, "glosario-campos.json");
    return items.flatMap((i) => ((i.sinonimo ?? i.etiqueta) ? [{ sinonimo: (i.sinonimo ?? i.etiqueta)!, clave: i.clave }] : []));
  }
  if (datos === null || typeof datos !== "object") throw new ErrorInsumo("glosario-campos.json debe ser un objeto o una lista.");
  const out: EntradaGlosario[] = [];
  for (const [k, v] of Object.entries(datos)) {
    if (Array.isArray(v)) for (const s of v) if (typeof s === "string") out.push({ sinonimo: s, clave: k });
    if (typeof v === "string") out.push(rutas.has(k) && !rutas.has(v) ? { sinonimo: v, clave: k } : { sinonimo: k, clave: v });
  }
  return out;
}
