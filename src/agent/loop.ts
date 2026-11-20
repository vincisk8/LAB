/**
 * Ciclo del agente con Claude (Anthropic Messages API + tool use).
 *
 *   usuario → [modelo] → ¿tool_use? ─sí→ validar entrada (zod) → ejecutar herramienta → tool_result → [modelo] …
 *                              └no→ respuesta final
 *   Corte de seguridad: si una herramienta pide confirmación humana, el turno TERMINA aunque el modelo
 *   quiera seguir; se retoma cuando el humano decide en la UI. Límite duro de iteraciones por turno.
 *
 * Optimización de costo: prompt caching sobre system prompt + definiciones de herramientas (estables).
 */
import Anthropic from "@anthropic-ai/sdk";
import { config, PRECIOS, SYSTEM_PROMPT } from "../config";
import { ejecutarHerramienta, definicionesHerramientas, type ContextoHerramientas } from "../tools/proveedor";
import type { Agente, Evento } from "./eventos";

type Msg = Anthropic.MessageParam;
const MAX_CHARS_RESULTADO = 12_000;

function compactar(obj: unknown): string {
  const s = JSON.stringify(obj);
  return s.length > MAX_CHARS_RESULTADO ? s.slice(0, MAX_CHARS_RESULTADO) + '…"[truncado]"' : s;
}

/**
 * Caché incremental: un único breakpoint "rodante" en el último bloque del historial, de modo que
 * cada iteración relee de caché todo lo anterior (0.05x–0.1x del precio de input) y solo paga lo nuevo.
 * Breakpoints usados: system + tools + este = 3 (límite de la API: 4).
 */
function marcarCacheIncremental(msgs: Msg[]) {
  for (const m of msgs) {
    if (Array.isArray(m.content)) for (const b of m.content as { cache_control?: unknown }[]) delete b.cache_control;
  }
  const ultimo = msgs[msgs.length - 1];
  if (!ultimo) return;
  if (typeof ultimo.content === "string") ultimo.content = [{ type: "text", text: ultimo.content }];
  const bloques = ultimo.content as { cache_control?: unknown }[];
  const b = bloques[bloques.length - 1];
  if (b) b.cache_control = { type: "ephemeral" };
}

export class AgenteClaude implements Agente {
  private cliente: Pick<Anthropic, "messages">;
  private conversaciones = new Map<string, Msg[]>();
  private herramientas: Anthropic.Tool[];

  /** `cliente` inyectable para pruebas (tests/loop.test.ts usa un modelo falso con guion). */
  constructor(private crearContexto: (sesionId: string) => ContextoHerramientas, cliente?: Pick<Anthropic, "messages">) {
    this.cliente = cliente ?? new Anthropic();
    const defs = definicionesHerramientas() as Anthropic.Tool[];
    // cache_control en la última herramienta → cachea system + todas las tools
    defs[defs.length - 1] = { ...defs[defs.length - 1]!, cache_control: { type: "ephemeral" } };
    this.herramientas = defs;
  }

  reiniciar(sesionId: string) {
    this.conversaciones.delete(sesionId);
  }

  async *turno(sesionId: string, mensaje: string): AsyncGenerator<Evento> {
    const msgs = this.conversaciones.get(sesionId) ?? [];
    this.conversaciones.set(sesionId, msgs);
    const ctx = this.crearContexto(sesionId);

    // Si el último mensaje es un tool_result (turno cortado por confirmación), se fusiona en el mismo mensaje user.
    const ultimo = msgs[msgs.length - 1];
    if (ultimo?.role === "user" && Array.isArray(ultimo.content)) {
      (ultimo.content as Anthropic.ContentBlockParam[]).push({ type: "text", text: mensaje });
    } else {
      msgs.push({ role: "user", content: mensaje });
    }

    const uso = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let iter = 0;
    try {
      while (iter < config.maxIteraciones) {
        iter++;
        marcarCacheIncremental(msgs);
        const resp = await this.cliente.messages.create({
          model: config.modelo,
          max_tokens: config.maxTokensSalida,
          system: [{ type: "text", text: SYSTEM_PROMPT + `\n\n# Contexto\nFecha de referencia para vigencias: ${ctx.fechaReferencia}.`, cache_control: { type: "ephemeral" } }],
          tools: this.herramientas,
          messages: msgs,
        });
        uso.input += resp.usage.input_tokens;
        uso.output += resp.usage.output_tokens;
        uso.cacheRead += resp.usage.cache_read_input_tokens ?? 0;
        uso.cacheWrite += resp.usage.cache_creation_input_tokens ?? 0;
        msgs.push({ role: "assistant", content: resp.content });

        for (const b of resp.content) if (b.type === "text" && b.text.trim()) yield { tipo: "texto", texto: b.text };
        if (resp.stop_reason !== "tool_use") break;

        const resultados: Anthropic.ToolResultBlockParam[] = [];
        let confirmacion: Extract<Evento, { tipo: "confirmacion" }>["confirmacion"] | undefined;
        for (const b of resp.content) {
          if (b.type !== "tool_use") continue;
          yield { tipo: "herramienta_inicio", id: b.id, nombre: b.name, entrada: b.input };
          const t0 = performance.now();
          const r = await ejecutarHerramienta(b.name, b.input, ctx);
          yield { tipo: "herramienta_fin", id: b.id, nombre: b.name, ok: r.ok, resultado: r.ok ? r.datos : r.error, ms: Math.round(performance.now() - t0) };
          resultados.push({ type: "tool_result", tool_use_id: b.id, content: compactar(r.ok ? r.datos : { error: r.error }), is_error: !r.ok });
          if (r.confirmacion_requerida) confirmacion = r.confirmacion_requerida;
        }
        msgs.push({ role: "user", content: resultados });
        if (confirmacion) {
          yield { tipo: "confirmacion", confirmacion };
          break; // human-in-the-loop: se corta el turno
        }
        if (iter === config.maxIteraciones) yield { tipo: "texto", texto: "⚠️ Alcancé el límite de pasos de este turno. Escribe «continúa» para seguir." };
      }
    } catch (e) {
      yield { tipo: "error", mensaje: `Error del modelo: ${(e as Error).message}` };
    }
    const p = PRECIOS[config.modelo] ?? PRECIOS["claude-sonnet-5-5"]!;
    const costo = (uso.input * p.input + uso.output * p.output + uso.cacheRead * p.cacheRead + uso.cacheWrite * p.cacheWrite) / 1e6;
    yield { tipo: "uso", modelo: config.modelo, iteraciones: iter, input_tokens: uso.input, output_tokens: uso.output, cache_read_tokens: uso.cacheRead, cache_write_tokens: uso.cacheWrite, costo_usd: Math.round(costo * 1e5) / 1e5 };
    yield { tipo: "fin" };
  }
}
