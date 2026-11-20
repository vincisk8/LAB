/**
 * Carga y valida los insumos del reto. Todas las rutas se resuelven dentro de la carpeta de
 * fixtures y se rechaza cualquier id con caracteres de ruta (evita path traversal desde el chat).
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Glosario, IndiceVigencias, Plantilla, RepositorioMaestro, Solicitud } from "./tipos";
import type { z } from "zod";

export const ID_CASO = /^[a-z0-9][a-z0-9-]{1,60}$/;

export class ErrorDominio extends Error {
  constructor(public codigo: string, mensaje: string) {
    super(mensaje);
  }
}

async function leerJson<T extends z.ZodTypeAny>(ruta: string, esquema: T): Promise<z.infer<T>> {
  let crudo: unknown;
  try {
    crudo = JSON.parse(await readFile(ruta, "utf8"));
  } catch (e) {
    throw new ErrorDominio("INSUMO_ILEGIBLE", `No se pudo leer ${ruta}: ${(e as Error).message}`);
  }
  const r = esquema.safeParse(crudo);
  if (!r.success) {
    throw new ErrorDominio("INSUMO_INVALIDO", `${ruta} no cumple el esquema: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return r.data;
}

export class Fixtures {
  readonly raiz: string;
  private cache = new Map<string, unknown>();

  constructor(raiz: string) {
    this.raiz = resolve(raiz);
  }

  private async memo<T>(clave: string, fn: () => Promise<T>): Promise<T> {
    if (!this.cache.has(clave)) this.cache.set(clave, await fn());
    return this.cache.get(clave) as T;
  }

  dentro(...partes: string[]): string {
    const ruta = resolve(this.raiz, ...partes);
    if (ruta !== this.raiz && !ruta.startsWith(this.raiz + sep)) throw new ErrorDominio("RUTA_INVALIDA", "Ruta fuera de fixtures");
    return ruta;
  }

  async listarCasos(): Promise<string[]> {
    const dir = this.dentro("casos");
    const entradas = await readdir(dir, { withFileTypes: true });
    return entradas.filter((e) => e.isDirectory() && ID_CASO.test(e.name)).map((e) => e.name).sort();
  }

  private validarId(casoId: string) {
    if (!ID_CASO.test(casoId)) throw new ErrorDominio("CASO_INVALIDO", `Id de caso inválido: "${casoId}"`);
    if (!existsSync(this.dentro("casos", casoId, "solicitud.json"))) throw new ErrorDominio("CASO_NO_EXISTE", `No existe el caso "${casoId}"`);
  }

  solicitud(casoId: string) {
    this.validarId(casoId);
    return this.memo(`sol:${casoId}`, () => leerJson(this.dentro("casos", casoId, "solicitud.json"), Solicitud));
  }

  async plantilla(casoId: string) {
    const sol = await this.solicitud(casoId);
    return this.memo(`pla:${casoId}`, () => leerJson(this.dentro("casos", casoId, sol.formulario.plantilla), Plantilla));
  }

  async rutaFormulario(casoId: string) {
    const sol = await this.solicitud(casoId);
    return this.dentro("casos", casoId, sol.formulario.archivo);
  }

  repositorio() {
    return this.memo("repo", () => leerJson(this.dentro("repositorio", "periferia.json"), RepositorioMaestro));
  }

  indiceVigencias() {
    return this.memo("idx", () => leerJson(this.dentro("repositorio", "indice-vigencias.json"), IndiceVigencias));
  }

  glosario() {
    return this.memo("glo", () => leerJson(this.dentro("glosario-campos.json"), Glosario));
  }

  rutaSoporte(archivo: string) {
    return this.dentro("repositorio", "soportes", archivo);
  }
}
