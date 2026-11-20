import { mkdtempSync } from "node:fs";
import { cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const RAIZ = join(import.meta.dir, "..");

/** Copia los fixtures a un directorio temporal para que las pruebas no ensucien out/ ni modifiquen fixtures/. */
export async function proyectoTemporal(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "reto01-"));
  await cp(join(RAIZ, "fixtures"), join(dir, "fixtures"), { recursive: true });
  return dir;
}

export type R = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };
export const parse = (s: string) => JSON.parse(s) as R;
export const datos = (s: string) => {
  const r = parse(s);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};
