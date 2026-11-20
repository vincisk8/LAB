/**
 * Implementación del adaptador para OpenAI (Chat Completions con tools) vía fetch, sin SDK.
 * Sirve también para endpoints compatibles (Azure OpenAI, Mistral, modelos locales) con OPENAI_BASE_URL.
 */
import { ErrorLLM, mensajeHttp, type AdaptadorLLM, type DefinicionHerramienta, type Mensaje, type OpcionesEnvio, type RespuestaLLM } from "./adapter";

type MensajeOpenAI =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface RespuestaOpenAI {
  choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
  usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
}

function convertir(mensajes: Mensaje[]): MensajeOpenAI[] {
  return mensajes.flatMap((m): MensajeOpenAI[] => {
    if (m.rol === "system" || m.rol === "user") return [{ role: m.rol, content: m.texto }];
    if (m.rol === "tool") return m.resultados.map((r) => ({ role: "tool" as const, tool_call_id: r.id, content: r.contenido }));
    const tool_calls = m.llamadas.map((l) => ({ id: l.id, type: "function" as const, function: { name: l.nombre, arguments: JSON.stringify(l.argumentos ?? {}) } }));
    return [{ role: "assistant", content: m.texto || null, ...(tool_calls.length ? { tool_calls } : {}) }];
  });
}

function parsearArgs(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { _argumentos_no_json: s };
  }
}

export class AdaptadorOpenAI implements AdaptadorLLM {
  readonly proveedor = "openai";

  constructor(readonly modelo: string, private apiKey: string, private baseUrl = "https://api.openai.com/v1") {}

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], opciones: OpcionesEnvio = {}): Promise<RespuestaLLM> {
    const cuerpo = {
      model: this.modelo,
      max_completion_tokens: opciones.maxTokens ?? 2048,
      messages: convertir(mensajes),
      tools: herramientas.map((h) => ({ type: "function", function: { name: h.nombre, description: h.descripcion, parameters: h.esquema } })),
    };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(cuerpo),
        signal: opciones.signal,
      });
    } catch {
      throw new ErrorLLM(opciones.signal?.aborted ? "OpenAI: tiempo de espera agotado." : "OpenAI: no se pudo contactar el servicio.");
    }
    if (!res.ok) throw new ErrorLLM(mensajeHttp("OpenAI", res.status));
    const r = (await res.json()) as RespuestaOpenAI;
    const msg = r.choices[0]?.message;
    return {
      texto: (msg?.content ?? "").trim(),
      llamadas: (msg?.tool_calls ?? []).map((t) => ({ id: t.id, nombre: t.function.name, argumentos: parsearArgs(t.function.arguments) })),
      uso: {
        entrada: r.usage?.prompt_tokens ?? 0,
        salida: r.usage?.completion_tokens ?? 0,
        cache_lectura: r.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cache_escritura: 0,
      },
    };
  }
}
