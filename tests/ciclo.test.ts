/** Ciclo del agente con adaptadores de prueba: sin red ni claves. */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ejecutarTurno, promptSistema, type Evento } from "../src/agent/ciclo";
import { AlmacenSesiones } from "../src/agent/sesiones";
import { ErrorLLM, type AdaptadorLLM, type Mensaje, type RespuestaLLM } from "../src/llm/adapter";
import { AdaptadorSimulado } from "../src/llm/simulado";
import { proyectoTemporal, RAIZ } from "./utiles";

const dir = await proyectoTemporal();
const sesiones = new AlmacenSesiones(join(dir, "out", "sesiones"));
const sistema = promptSistema(RAIZ);

async function correr(adaptador: AdaptadorLLM, sesionId: string, mensaje: string, maxIteraciones?: number) {
  const eventos: Evento[] = [];
  for await (const e of ejecutarTurno(sesiones.obtener(sesionId), mensaje, { adaptador, directorio: dir, sistema, maxIteraciones })) eventos.push(e);
  return { eventos, fin: eventos.find((e) => e.tipo === "fin") as Extract<Evento, { tipo: "fin" }> };
}

test("prompt del PRD (§11): procesa sin enviar, cierra con confirmación; «envía» solo escribe ENVIO-SIMULADO.md", async () => {
  const a = new AdaptadorSimulado();
  const t1 = await correr(a, "sesion-prd-11", 'Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.');
  expect(t1.fin.toolCalls.map((t) => t.nombre)).toEqual(["proveedor_leer_solicitud", "proveedor_mapear_campos", "proveedor_generar_formulario", "proveedor_armar_paquete"]);
  expect(t1.fin.needsConfirmation).toBe(true);
  expect(t1.fin.reply).toContain("out/ec-corp-andina/paquete");
  expect(t1.fin.reply).toMatch(/\?/);
  expect(existsSync(join(dir, "out/ec-corp-andina/ENVIO-SIMULADO.md"))).toBe(false);

  const t2 = await correr(a, "sesion-prd-11", "envía");
  expect(t2.fin.toolCalls.map((t) => t.nombre)).toEqual(["proveedor_simular_envio"]);
  expect(t2.fin.toolCalls[0]!.ok).toBe(true);
  expect(existsSync(join(dir, "out/ec-corp-andina/ENVIO-SIMULADO.md"))).toBe(true);
});

/** Modelo "desobediente": intenta enviar sin confirmación en cada iteración. */
class Desobediente implements AdaptadorLLM {
  readonly proveedor = "prueba";
  readonly modelo = "desobediente";
  n = 0;
  async enviar(_m: Mensaje[], herramientas: unknown[]): Promise<RespuestaLLM> {
    this.n++;
    const uso = { entrada: 10, salida: 5, cache_lectura: 0, cache_escritura: 0 };
    if (!herramientas.length) return { texto: "Resumen: no pude enviar; falta tu confirmación.", llamadas: [], uso };
    return { texto: "", llamadas: [{ id: `t${this.n}`, nombre: "proveedor_simular_envio", argumentos: { caso: "co-industrias-delta", confirmado: true } }], uso };
  }
}

test("CA1 + RN4: tope de iteraciones y el backend bloquea el envío aunque el modelo insista", async () => {
  const a = new Desobediente();
  const { fin } = await correr(a, "sesion-tope", "procesa y envía co-industrias-delta", 3);
  expect(fin.toolCalls.length).toBe(3);
  expect(fin.toolCalls.every((t) => !t.ok && t.resumen.startsWith("requiere confirmación explícita"))).toBe(true);
  expect(a.n).toBe(4); // 3 iteraciones + 1 resumen final sin herramientas
  expect(fin.reply).toContain("Resumen");
});

test("CA5: un error del proveedor se muestra claro y la sesión sigue viva", async () => {
  const caido: AdaptadorLLM = { proveedor: "prueba", modelo: "caido", enviar: async () => { throw new ErrorLLM("Anthropic: tiempo de espera agotado."); } };
  const { eventos } = await correr(caido, "sesion-error", "hola");
  expect(eventos.some((e) => e.tipo === "error" && e.mensaje.includes("tiempo de espera"))).toBe(true);
  const { fin } = await correr(new AdaptadorSimulado(), "sesion-error", "¿qué casos hay?");
  expect(fin.toolCalls[0]!.nombre).toBe("proveedor_listar_casos");
});

test("tope de tokens por sesión", async () => {
  const s = sesiones.obtener("sesion-tokens");
  s.tokens = 10_000_000;
  const { fin } = await correr(new AdaptadorSimulado(), "sesion-tokens", "hola");
  expect(fin.reply).toContain("tope de tokens");
});
