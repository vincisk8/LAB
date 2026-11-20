/**
 * Estimación de costo por solicitud procesada, a partir de los tamaños REALES de:
 *   - system prompt (agent/prompt.md) + definiciones de herramientas (JSON Schema desde zod)
 *   - resultados de herramientas de cada caso (ejecutadas aquí sin LLM)
 * y un ciclo típico del agente de 7 llamadas al modelo por caso.
 *
 * Tokens ≈ caracteres / 3.2 (conservador para español + JSON). Con ANTHROPIC_API_KEY definida usa el
 * endpoint count_tokens para medir el bloque estático con el tokenizador real.
 *
 * Uso: bun scripts/costos.ts [--volumen=1000]
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRECIOS, SYSTEM_PROMPT, config } from "../src/config";
import { AlmacenSesiones } from "../src/domain/estado";
import { Fixtures } from "../src/domain/fixtures";
import { definicionesHerramientas, ejecutarHerramienta } from "../src/tools/proveedor";

const VOLUMEN = Number(process.argv.find((a) => a.startsWith("--volumen="))?.split("=")[1] ?? 1000);
const tok = (s: string) => Math.ceil(s.length / 3.2);

let estatico = tok(SYSTEM_PROMPT) + tok(JSON.stringify(definicionesHerramientas()));
let fuente = "estimado (caracteres/3.2)";
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const r = await new Anthropic().messages.countTokens({ model: config.modelo, system: SYSTEM_PROMPT, tools: definicionesHerramientas() as never, messages: [{ role: "user", content: "hola" }] });
    estatico = r.input_tokens;
    fuente = `medido con count_tokens (${config.modelo})`;
  } catch (e) {
    console.warn("count_tokens no disponible:", (e as Error).message);
  }
}

const fx = new Fixtures(join(import.meta.dir, "..", "fixtures", "reto-01"));
const casos = await fx.listarCasos();

// Ciclo típico: [herramientas llamadas en esa iteración, tokens de salida del modelo]
const CICLO: [string[], number][] = [
  [["leer_solicitud"], 120],
  [["mapear_campos", "verificar_soportes"], 120],
  [["validar_datos"], 100],
  [["llenar_formulario"], 100],
  [["solicitar_confirmacion_humana"], 450], // resumen al humano
  [["armar_paquete"], 80], // turno 2, tras aprobación
  [[], 300], // respuesta final con enlaces
];

type Fila = { caso: string; llamadas: number; input: number; output: number; cache_read: number; cache_write: number; [k: string]: string | number };
const filas: Fila[] = [];
for (const caso of casos) {
  const sesion = new AlmacenSesiones(() => "2026-11-19T12:00:00Z").obtener("costos");
  const ctx = { fixtures: fx, sesion, fechaReferencia: "2026-11-19", dirSalida: mkdtempSync(join(tmpdir(), "costos-")) };
  let historial = 60; // mensaje del usuario
  let inputSinCache = 0, output = 0, cacheRead = 0, cacheWrite = 0, previo = 0;
  for (const [i, [herrs, out]] of CICLO.entries()) {
    // Sin caché: cada llamada paga estático + historial completo como input base.
    inputSinCache += estatico + historial;
    // Con caché: 1ª llamada escribe estático + historial; las siguientes leen el prefijo y escriben solo lo nuevo.
    if (i === 0) cacheWrite += estatico + historial;
    else { cacheRead += estatico + previo; cacheWrite += historial - previo; }
    previo = historial;
    output += out;
    historial += out + herrs.length * 40; // texto + bloques tool_use
    for (const h of herrs) {
      let entrada: Record<string, unknown> = { caso_id: caso };
      if (h === "solicitar_confirmacion_humana") {
        const v = (await ejecutarHerramienta("validar_datos", entrada, ctx)).datos as { resumen: { puede_paquete_final: boolean } };
        entrada = { ...entrada, modo: v.resumen.puede_paquete_final ? "final" : "borrador", resumen: "Resumen para el humano con hallazgos y pendientes." };
      }
      if (h === "armar_paquete") {
        const c = [...sesion.confirmaciones.values()].at(-1)!;
        sesion.decidir(c.id, "aprobar", "costos");
        entrada = { caso_id: caso, confirmacion_id: c.id };
      }
      const r = await ejecutarHerramienta(h, entrada, ctx);
      historial += tok(JSON.stringify(r.ok ? r.datos : r.error));
    }
  }
  const fila: Fila = { caso, llamadas: CICLO.length, input: inputSinCache, output, cache_read: cacheRead, cache_write: cacheWrite };
  for (const [modelo, p] of Object.entries(PRECIOS).filter(([m]) => m.includes("5-5"))) {
    const sin = (inputSinCache * p.input + output * p.output) / 1e6;
    const con = (cacheRead * p.cacheRead + cacheWrite * p.cacheWrite + output * p.output) / 1e6;
    fila[`${modelo.replace("claude-", "")} sin caché`] = `$${sin.toFixed(4)}`;
    fila[`${modelo.replace("claude-", "")} con caché`] = `$${con.toFixed(4)}`;
  }
  filas.push(fila);
}

console.log(`Bloque estático (system + tools): ${estatico} tokens — ${fuente}`);
console.table(filas);
const prom = (modelo: string, cache: boolean) => filas.reduce((s, f) => s + Number(String(f[`${modelo.replace("claude-", "")} ${cache ? "con" : "sin"} caché`]).slice(1)), 0) / filas.length;
console.log(`\nProyección para ${VOLUMEN.toLocaleString("es-CO")} solicitudes:`);
for (const m of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]) {
  console.log(`  ${m.padEnd(18)} sin caché ≈ US$ ${(prom(m, false) * VOLUMEN).toFixed(2).padStart(8)}   con caché ≈ US$ ${(prom(m, true) * VOLUMEN).toFixed(2).padStart(8)}`);
}
