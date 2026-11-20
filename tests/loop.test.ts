/**
 * Prueba del ciclo del agente con un modelo FALSO (sin red ni API key): verifica que el loop ejecuta
 * herramientas, devuelve tool_result, se corta en la confirmación humana y retoma correctamente.
 */
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgenteClaude } from "../src/agent/loop";
import type { Evento } from "../src/agent/eventos";
import { AlmacenSesiones } from "../src/domain/estado";
import { Fixtures } from "../src/domain/fixtures";

const almacen = new AlmacenSesiones(() => "2026-11-19T12:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "loop-"));
const crearContexto = (id: string) => ({ fixtures: new Fixtures(join(import.meta.dir, "..", "fixtures", "reto-01")), sesion: almacen.obtener(id), fechaReferencia: "2026-11-19", dirSalida: dir });

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const guion = [
  { stop_reason: "tool_use", content: [{ type: "text", text: "Reviso la solicitud." }, { type: "tool_use", id: "t1", name: "validar_datos", input: { caso_id: "co-industrias-delta" } }] },
  { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "solicitar_confirmacion_humana", input: { caso_id: "co-industrias-delta", modo: "final", resumen: "Paquete final sin hallazgos" } }] },
  // tras la aprobación humana:
  { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t3", name: "armar_paquete", input: { caso_id: "co-industrias-delta", confirmacion_id: "CONF-co-industrias-delta-001" } }] },
  { stop_reason: "end_turn", content: [{ type: "text", text: "✅ Listo para firma." }] },
];
const llamadas: unknown[] = [];
const falso = {
  messages: {
    create: async (req: unknown) => {
      llamadas.push(structuredClone(req));
      return { ...guion[llamadas.length - 1], usage };
    },
  },
};

async function recolectar(gen: AsyncGenerator<Evento>) {
  const out: Evento[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

test("loop: herramientas → corte en confirmación → retoma tras aprobación", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agente = new AgenteClaude(crearContexto, falso as any);
  const t1 = await recolectar(agente.turno("sesion-loop-1", "Procesa Industrias Delta"));
  expect(t1.filter((e) => e.tipo === "herramienta_fin").map((e) => (e as { nombre: string }).nombre)).toEqual(["validar_datos", "solicitar_confirmacion_humana"]);
  expect(t1.some((e) => e.tipo === "confirmacion")).toBe(true);
  expect(llamadas.length).toBe(2); // se cortó: no hubo tercera llamada al modelo

  almacen.obtener("sesion-loop-1").decidir("CONF-co-industrias-delta-001", "aprobar", "tester");
  const t2 = await recolectar(agente.turno("sesion-loop-1", "✅ Apruebo CONF-co-industrias-delta-001"));
  const fin = t2.find((e) => e.tipo === "herramienta_fin") as { ok: boolean; resultado: { estado: string } };
  expect(fin.ok).toBe(true);
  expect(fin.resultado.estado).toBe("LISTO_PARA_FIRMA");
  expect(t2.some((e) => e.tipo === "texto" && e.texto.includes("Listo"))).toBe(true);

  // El mensaje del usuario se fusionó con el tool_result pendiente (alternancia user/assistant válida)
  const req3 = llamadas[2] as { messages: { role: string; content: unknown }[] };
  const roles = req3.messages.map((m) => m.role);
  for (let i = 1; i < roles.length; i++) expect(roles[i]).not.toBe(roles[i - 1]);
  const uso = t2.find((e) => e.tipo === "uso") as { costo_usd: number };
  expect(uso.costo_usd).toBeGreaterThan(0);
});
