/** Registro de ejecuciones (CA4, RN5): out/log.jsonl y out/<caso>/log.jsonl. Nunca lanza. */
import { appendFile, mkdir } from "node:fs/promises";
import { rutaOut } from "./insumos";

export interface EntradaBitacora {
  ts: string;
  sesion: string;
  herramienta: string;
  caso?: string;
  ok: boolean;
  resumen: string;
}

export async function registrar(directory: string, e: EntradaBitacora): Promise<void> {
  const linea = JSON.stringify(e) + "\n";
  try {
    await mkdir(rutaOut(directory), { recursive: true });
    await appendFile(rutaOut(directory, "log.jsonl"), linea);
    if (e.caso && /^[a-z0-9][a-z0-9-]{1,80}$/.test(e.caso)) {
      await mkdir(rutaOut(directory, e.caso), { recursive: true });
      await appendFile(rutaOut(directory, e.caso, "log.jsonl"), linea);
    }
  } catch {
    // La bitácora es best-effort: un fallo de disco no debe tumbar la herramienta.
  }
}
