/** Selección del proveedor de LLM por variables de entorno. El ciclo del agente no cambia. */
import type { AdaptadorLLM } from "./adapter";
import { AdaptadorAnthropic } from "./anthropic";
import { AdaptadorOpenAI } from "./openai";
import { AdaptadorSimulado } from "./simulado";

export function crearAdaptador(env: Record<string, string | undefined> = process.env): AdaptadorLLM {
  const proveedor = env.LLM_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "anthropic" : env.OPENAI_API_KEY ? "openai" : "simulado");
  if (proveedor === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("LLM_PROVIDER=anthropic requiere ANTHROPIC_API_KEY");
    return new AdaptadorAnthropic(env.LLM_MODEL ?? "claude-sonnet-5-5", env.ANTHROPIC_API_KEY);
  }
  if (proveedor === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("LLM_PROVIDER=openai requiere OPENAI_API_KEY");
    return new AdaptadorOpenAI(env.LLM_MODEL ?? "gpt-5-mini", env.OPENAI_API_KEY, env.OPENAI_BASE_URL);
  }
  return new AdaptadorSimulado();
}
