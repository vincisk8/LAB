/**
 * Registro de herramientas: toma los exports de src/tools/proveedor.ts y los expone como
 * `proveedor_<export>`, con JSON Schema generado desde zod para el adaptador LLM.
 */
import { z } from "zod";
import { registrar } from "../core/bitacora";
import type { Contexto, Herramienta } from "../core/herramienta";
import type { DefinicionHerramienta } from "../llm/adapter";
import * as proveedor from "./proveedor";

export interface HerramientaRegistrada {
  nombre: string;
  herramienta: Herramienta;
}

export const HERRAMIENTAS: HerramientaRegistrada[] = Object.entries(proveedor).map(([exp, h]) => ({ nombre: `proveedor_${exp}`, herramienta: h as Herramienta }));

export function definiciones(): DefinicionHerramienta[] {
  return HERRAMIENTAS.map(({ nombre, herramienta }) => {
    const { $schema: _s, ...esquema } = z.toJSONSchema(z.object(herramienta.args), { target: "draft-7", io: "input" }) as Record<string, unknown>;
    return { nombre, descripcion: herramienta.description, esquema: { type: "object", ...esquema } };
  });
}

export interface ResultadoEjecucion {
  ok: boolean;
  contenido: string;
  resumen: string;
}

function resumir(contenido: string): { ok: boolean; resumen: string } {
  try {
    const r = JSON.parse(contenido) as { ok?: boolean; error?: string; data?: Record<string, unknown> };
    if (!r.ok) return { ok: false, resumen: r.error ?? "error" };
    const d = r.data ?? {};
    const partes = ["ruta", "formato", "listo_para_firma", "mapeo_id", "cliente"].filter((k) => k in d).map((k) => `${k}: ${String(d[k])}`);
    for (const k of ["llenos", "faltantes", "requiere_confirmacion", "campos", "soportes", "casos"]) if (Array.isArray(d[k])) partes.push(`${k}: ${(d[k] as unknown[]).length}`);
    return { ok: true, resumen: partes.join(" · ") || "ok" };
  } catch {
    return { ok: false, resumen: "respuesta no JSON" };
  }
}

/** El backend valida los argumentos con zod ANTES de ejecutar y devuelve el error al modelo si no cumplen. */
export async function ejecutar(nombre: string, args: unknown, ctx: Contexto): Promise<ResultadoEjecucion> {
  const h = HERRAMIENTAS.find((x) => x.nombre === nombre);
  if (!h) {
    const contenido = JSON.stringify({ ok: false, error: `La herramienta ${nombre} no existe. Disponibles: ${HERRAMIENTAS.map((x) => x.nombre).join(", ")}` });
    await registrar(ctx.directory, { ts: new Date().toISOString(), sesion: ctx.sessionId, herramienta: nombre, ok: false, resumen: "herramienta desconocida" });
    return { ok: false, contenido, resumen: "herramienta desconocida" };
  }
  const v = z.object(h.herramienta.args).safeParse(args ?? {});
  if (!v.success) {
    const error = `Argumentos inválidos para ${nombre}: ${v.error.issues.map((i) => `${i.path.join(".") || "(raíz)"} ${i.message}`).join("; ")}`;
    const caso = args && typeof args === "object" && "caso" in args && typeof args.caso === "string" ? args.caso : undefined;
    await registrar(ctx.directory, { ts: new Date().toISOString(), sesion: ctx.sessionId, herramienta: nombre, caso, ok: false, resumen: error });
    return { ok: false, contenido: JSON.stringify({ ok: false, error }), resumen: error };
  }
  const contenido = await h.herramienta.execute(v.data, ctx);
  return { contenido, ...resumir(contenido) };
}
