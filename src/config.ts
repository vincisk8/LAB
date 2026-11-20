import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Precios USD por millón de tokens (platform.claude.com/docs/en/about-claude/pricing, nov-2026). */
export const PRECIOS: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

function hoyBogota(): string {
  // Fecha local de Colombia (UTC-5, sin horario de verano)
  return new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
}

export const config = {
  puerto: Number(process.env.PORT ?? 3000),
  modo: (process.env.AGENT_MODE ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "simulado")) as "anthropic" | "simulado",
  modelo: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
  maxIteraciones: Number(process.env.MAX_ITERACIONES ?? 14),
  maxTokensSalida: Number(process.env.MAX_TOKENS_SALIDA ?? 2048),
  fixtures: process.env.FIXTURES_DIR ?? join(RAIZ, "fixtures", "reto-01"),
  dirSalida: process.env.OUTPUT_DIR ?? join(RAIZ, "output", "sesiones"),
  /** Fecha contra la que se calculan vigencias. Fijarla hace reproducible la defensa técnica. */
  fechaReferencia: process.env.FECHA_REFERENCIA ?? hoyBogota(),
  /** Si se define, la UI pide este código antes de usar el chat (protege la URL pública y la API key). */
  codigoAcceso: process.env.ACCESS_CODE ?? "",
  limitePorMinuto: Number(process.env.RATE_LIMIT_PER_MIN ?? 20),
};

export const SYSTEM_PROMPT = readFileSync(join(RAIZ, "agent", "prompt.md"), "utf8");
