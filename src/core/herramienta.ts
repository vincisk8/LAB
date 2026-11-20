/**
 * Contrato de herramientas del PRD (§6.2):
 *   { description, args: {campo: zod.describe()}, execute(args, ctx) → string JSON {ok,data}|{ok:false,error} }
 * `definir` añade validación zod defensiva, captura de errores (nunca lanza) y bitácora.
 */
import { z } from "zod";
import { registrar } from "./bitacora";
import { ErrorInsumo } from "./insumos";

export interface Contexto {
  /** Raíz del proyecto; todas las rutas se resuelven desde aquí. */
  directory: string;
  sessionId: string;
  /** Fecha de ejecución YYYY-MM-DD (opcional; por defecto FECHA_EJECUCION o la fecha de hoy en Bogotá). */
  fecha?: string;
}

export type Salida<T> = { ok: true; data: T; resumen: string } | { ok: false; error: string };

export interface Herramienta<A extends z.ZodRawShape = z.ZodRawShape> {
  description: string;
  args: A;
  execute: (args: z.infer<z.ZodObject<A>>, ctx: Contexto) => Promise<string>;
}

export function fechaEjecucion(ctx: Contexto): string {
  if (ctx.fecha) return ctx.fecha;
  if (process.env.FECHA_EJECUCION && /^\d{4}-\d{2}-\d{2}$/.test(process.env.FECHA_EJECUCION)) return process.env.FECHA_EJECUCION;
  return new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10); // America/Bogota (UTC-5)
}

function mensajeError(nombre: string, e: unknown): string {
  if (e instanceof ErrorInsumo) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  return `Error inesperado en ${nombre}: ${m.split("\n")[0]}`;
}

export function definir<A extends z.ZodRawShape, T>(
  nombre: string,
  description: string,
  args: A,
  fn: (args: z.infer<z.ZodObject<A>>, ctx: Contexto) => Promise<Salida<T>>,
): Herramienta<A> {
  const esquema = z.object(args);
  return {
    description,
    args,
    async execute(entrada, ctx) {
      const parsed = esquema.safeParse(entrada);
      let salida: Salida<T>;
      if (!parsed.success) {
        salida = { ok: false, error: `Argumentos inválidos: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(raíz)"} ${i.message}`).join("; ")}` };
      } else {
        try {
          salida = await fn(parsed.data, ctx);
        } catch (e) {
          salida = { ok: false, error: mensajeError(nombre, e) };
        }
      }
      const caso = entrada && typeof entrada === "object" && "caso" in entrada && typeof entrada.caso === "string" ? entrada.caso : undefined;
      await registrar(ctx.directory, { ts: new Date().toISOString(), sesion: ctx.sessionId, herramienta: nombre, caso, ok: salida.ok, resumen: salida.ok ? salida.resumen : salida.error });
      return JSON.stringify(salida.ok ? { ok: true, data: salida.data } : { ok: false, error: salida.error });
    },
  };
}
