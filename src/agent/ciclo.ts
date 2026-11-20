/**
 * Ciclo del agente (PRD §6.3), independiente del proveedor de LLM:
 *
 *   mensaje usuario → registrar posible confirmación (RN4)
 *   repetir hasta MAX_ITERACIONES:
 *     modelo(prompt + conocimiento + historial, herramientas)
 *     sin llamadas → respuesta final
 *     con llamadas → validar (zod) → ejecutar → resultado al historial y al chat (CA4)
 *   al tope → una última llamada SIN herramientas: "resume lo que tienes y lo que falta" (CA1)
 *   needsConfirmation = hay un paquete esperando confirmación de envío (CA3)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config, RAIZ } from "../config";
import { ErrorLLM, type AdaptadorLLM, type Mensaje, type ResultadoHerramienta } from "../llm/adapter";
import { pendientesDeConfirmacion, registrarMensajeUsuario } from "../tools/confirmaciones";
import { definiciones, ejecutar } from "../tools/registro";
import type { LlamadaVisible, Sesion } from "./sesiones";

export type Evento =
  | { tipo: "pensando"; iteracion: number }
  | { tipo: "texto"; texto: string }
  | { tipo: "herramienta_inicio"; id: string; nombre: string; argumentos: unknown }
  | { tipo: "herramienta_fin"; id: string; nombre: string; ok: boolean; resumen: string; resultado: unknown }
  | { tipo: "error"; mensaje: string }
  | { tipo: "fin"; reply: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean; tokens_sesion: number };

/** Comportamiento (agent/prompt.md) + conocimiento (src/knowledge/registro-proveedor.md). */
export function promptSistema(directorio = RAIZ): string {
  const prompt = readFileSync(join(directorio, "agent", "prompt.md"), "utf8");
  const conocimiento = readFileSync(join(directorio, "src", "knowledge", "registro-proveedor.md"), "utf8");
  return `${prompt}\n\n---\n\n${conocimiento}`;
}

export interface Dependencias {
  adaptador: AdaptadorLLM;
  directorio: string;
  sistema: string;
  maxIteraciones?: number;
  maxTokensSesion?: number;
}

function parsear(contenido: string): unknown {
  try {
    return JSON.parse(contenido);
  } catch {
    return contenido;
  }
}

async function llamarModelo(dep: Dependencias, mensajes: Mensaje[], conHerramientas: boolean) {
  const signal = AbortSignal.timeout(config.timeoutLlmMs);
  return dep.adaptador.enviar([{ rol: "system", texto: dep.sistema }, ...mensajes], conHerramientas ? definiciones() : [], { signal, maxTokens: config.maxTokensRespuesta });
}

export async function* ejecutarTurno(sesion: Sesion, mensajeUsuario: string, dep: Dependencias): AsyncGenerator<Evento> {
  const maxIter = dep.maxIteraciones ?? config.maxIteraciones;
  const maxTokens = dep.maxTokensSesion ?? config.maxTokensSesion;
  const ctx = { directory: dep.directorio, sessionId: sesion.id };
  const toolCalls: LlamadaVisible[] = [];
  const textos: string[] = [];
  registrarMensajeUsuario(sesion.id, mensajeUsuario);
  sesion.mensajes.push({ rol: "user", texto: mensajeUsuario });

  const terminar = function* (): Generator<Evento> {
    yield { tipo: "fin", reply: textos.join("\n\n"), toolCalls, needsConfirmation: pendientesDeConfirmacion(sesion.id).length > 0, tokens_sesion: sesion.tokens };
  };

  try {
    for (let i = 1; i <= maxIter; i++) {
      if (sesion.tokens >= maxTokens) {
        const m = `Se alcanzó el tope de tokens de esta sesión (${maxTokens.toLocaleString("es-CO")}). Inicia una sesión nueva para continuar.`;
        textos.push(m);
        yield { tipo: "texto", texto: m };
        return yield* terminar();
      }
      yield { tipo: "pensando", iteracion: i };
      const r = await llamarModelo(dep, sesion.mensajes, true);
      sesion.tokens += r.uso.entrada + r.uso.salida + r.uso.cache_lectura + r.uso.cache_escritura;
      sesion.mensajes.push({ rol: "assistant", texto: r.texto, llamadas: r.llamadas });
      if (r.texto) {
        textos.push(r.texto);
        yield { tipo: "texto", texto: r.texto };
      }
      if (!r.llamadas.length) return yield* terminar();

      const resultados: ResultadoHerramienta[] = [];
      for (const l of r.llamadas) {
        yield { tipo: "herramienta_inicio", id: l.id, nombre: l.nombre, argumentos: l.argumentos };
        const e = await ejecutar(l.nombre, l.argumentos, ctx);
        toolCalls.push({ nombre: l.nombre, argumentos: l.argumentos, ok: e.ok, resumen: e.resumen });
        resultados.push({ id: l.id, nombre: l.nombre, contenido: e.contenido, esError: !e.ok });
        yield { tipo: "herramienta_fin", id: l.id, nombre: l.nombre, ok: e.ok, resumen: e.resumen, resultado: parsear(e.contenido) };
      }
      sesion.mensajes.push({ rol: "tool", resultados });
    }
    // CA1: tope alcanzado → respuesta con lo que hay y lo que falta, sin más herramientas.
    sesion.mensajes.push({ rol: "user", texto: `[Sistema] Se alcanzó el tope de ${maxIter} iteraciones. Sin llamar herramientas, resume lo que lograste y lo que falta.` });
    const r = await llamarModelo(dep, sesion.mensajes, false);
    sesion.tokens += r.uso.entrada + r.uso.salida;
    sesion.mensajes.push({ rol: "assistant", texto: r.texto, llamadas: [] });
    textos.push(r.texto);
    yield { tipo: "texto", texto: r.texto };
    yield* terminar();
  } catch (e) {
    // CA5: error del proveedor en lenguaje claro; la sesión sigue viva.
    const mensaje = e instanceof ErrorLLM ? e.message : `Error inesperado: ${(e as Error).message.split("\n")[0]}`;
    const ultimo = sesion.mensajes[sesion.mensajes.length - 1];
    if (ultimo?.rol === "assistant" && ultimo.llamadas.length) sesion.mensajes.pop(); // no dejar tool_use sin resultado
    sesion.mensajes.push({ rol: "assistant", texto: `(No pude completar la respuesta: ${mensaje})`, llamadas: [] });
    yield { tipo: "error", mensaje };
    yield* terminar();
  }
}
