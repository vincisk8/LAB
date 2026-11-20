/** Sesiones en memoria con respaldo en archivo (out/sesiones/<id>.json). Sin base de datos (PRD §3.2). */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Mensaje } from "../llm/adapter";

export const RE_SESION = /^[A-Za-z0-9_-]{6,64}$/;

export interface LlamadaVisible {
  nombre: string;
  argumentos: unknown;
  ok: boolean;
  resumen: string;
}

export interface EntradaVisible {
  rol: "user" | "assistant" | "error";
  texto: string;
  toolCalls?: LlamadaVisible[];
  needsConfirmation?: boolean;
  ts: string;
}

export interface Sesion {
  id: string;
  mensajes: Mensaje[];
  visible: EntradaVisible[];
  tokens: number;
}

export class AlmacenSesiones {
  private sesiones = new Map<string, Sesion>();
  constructor(private dir: string) {}

  obtener(id: string): Sesion {
    const enMemoria = this.sesiones.get(id);
    if (enMemoria) return enMemoria;
    const archivo = join(this.dir, `${id}.json`);
    const s: Sesion = existsSync(archivo) ? (JSON.parse(readFileSync(archivo, "utf8")) as Sesion) : { id, mensajes: [], visible: [], tokens: 0 };
    this.sesiones.set(id, s);
    return s;
  }

  existe(id: string): boolean {
    return this.sesiones.has(id) || existsSync(join(this.dir, `${id}.json`));
  }

  async guardar(s: Sesion): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${s.id}.json`), JSON.stringify(s, null, 2));
  }

  reiniciar(id: string): void {
    this.sesiones.set(id, { id, mensajes: [], visible: [], tokens: 0 });
  }
}
