/** Implementación del adaptador para Anthropic (Claude) con prompt caching. */
import Anthropic from "@anthropic-ai/sdk";
import { ErrorLLM, mensajeHttp, type AdaptadorLLM, type DefinicionHerramienta, type Mensaje, type OpcionesEnvio, type RespuestaLLM } from "./adapter";

type Bloque = Anthropic.ContentBlockParam;

function convertir(mensajes: Mensaje[]): { system: string; messages: Anthropic.MessageParam[] } {
  const system = mensajes.filter((m) => m.rol === "system").map((m) => m.texto).join("\n\n");
  const messages: Anthropic.MessageParam[] = [];
  const agregar = (role: "user" | "assistant", bloques: Bloque[]) => {
    const ultimo = messages[messages.length - 1];
    if (ultimo && ultimo.role === role && Array.isArray(ultimo.content)) ultimo.content.push(...bloques);
    else messages.push({ role, content: bloques });
  };
  for (const m of mensajes) {
    if (m.rol === "user") agregar("user", [{ type: "text", text: m.texto }]);
    if (m.rol === "tool") agregar("user", m.resultados.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.contenido, is_error: r.esError })));
    if (m.rol === "assistant") {
      const bloques: Bloque[] = [];
      if (m.texto) bloques.push({ type: "text", text: m.texto });
      for (const l of m.llamadas) bloques.push({ type: "tool_use", id: l.id, name: l.nombre, input: l.argumentos ?? {} });
      if (bloques.length) agregar("assistant", bloques);
    }
  }
  // Caché incremental: breakpoint en el último bloque del historial.
  const ultimo = messages[messages.length - 1];
  if (ultimo && Array.isArray(ultimo.content)) {
    const b = ultimo.content[ultimo.content.length - 1];
    if (b && (b.type === "text" || b.type === "tool_result")) b.cache_control = { type: "ephemeral" };
  }
  return { system, messages };
}

export class AdaptadorAnthropic implements AdaptadorLLM {
  readonly proveedor = "anthropic";
  private cliente: Anthropic;

  constructor(readonly modelo: string, apiKey: string) {
    this.cliente = new Anthropic({ apiKey, maxRetries: 1 });
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], opciones: OpcionesEnvio = {}): Promise<RespuestaLLM> {
    const { system, messages } = convertir(mensajes);
    const tools: Anthropic.Tool[] = herramientas.map((h, i) => ({
      name: h.nombre,
      description: h.descripcion,
      input_schema: h.esquema as Anthropic.Tool.InputSchema,
      ...(i === herramientas.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
    try {
      const r = await this.cliente.messages.create(
        { model: this.modelo, max_tokens: opciones.maxTokens ?? 2048, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], tools, messages },
        { signal: opciones.signal },
      );
      return {
        texto: r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim(),
        llamadas: r.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, nombre: b.name, argumentos: b.input }] : [])),
        uso: { entrada: r.usage.input_tokens, salida: r.usage.output_tokens, cache_lectura: r.usage.cache_read_input_tokens ?? 0, cache_escritura: r.usage.cache_creation_input_tokens ?? 0 },
      };
    } catch (e) {
      if (e instanceof Anthropic.APIError && typeof e.status === "number") throw new ErrorLLM(mensajeHttp("Anthropic", e.status));
      if (opciones.signal?.aborted) throw new ErrorLLM("Anthropic: tiempo de espera agotado.");
      throw new ErrorLLM("Anthropic: no se pudo contactar el servicio.");
    }
  }
}
