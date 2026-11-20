#!/usr/bin/env bun
/**
 * demo.ts — Verificación determinista SIN modelo de lenguaje.
 *
 * Procesa los 4 casos de prueba llamando directamente a las MISMAS herramientas que usa el agente
 * (src/tools/proveedor.ts), simula las intervenciones humanas de forma explícita y verifica
 * expectativas. Con --check ejecuta todo dos veces en carpetas distintas y compara los SHA-256 de
 * todos los archivos generados para demostrar determinismo byte a byte.
 *
 * Uso:
 *   bun demo.ts                       # fecha de referencia 2026-11-19
 *   bun demo.ts --check               # + prueba de determinismo (2 corridas)
 *   bun demo.ts --fecha=2026-11-25    # otra fecha de referencia
 *   bun demo.ts --caso=pa-logistica-istmo
 *   npx tsx demo.ts                   # también corre en Node 20+
 */
import { createHash } from "node:crypto";
import { readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { AlmacenSesiones } from "./src/domain/estado";
import { Fixtures } from "./src/domain/fixtures";
import { ejecutarHerramienta, type ContextoHerramientas, type ResultadoHerramienta } from "./src/tools/proveedor";

const DIR = dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? "true"]; }));
const FECHA = args.fecha ?? "2026-11-19";
const FIXTURES = join(DIR, "fixtures", "reto-01");

const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", c: "\x1b[36m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };
const log = (...m: unknown[]) => console.log(...m);

/** Respuestas humanas simuladas (en la app real las da el usuario en el chat). */
const RESPUESTAS_HUMANAS: Record<string, { campo_id: string; valor: string; motivo: string }[]> = {
  "hn-agroexport-sula": [{ campo_id: "h09", valor: "En trámite", motivo: "El cliente indica 'En trámite' si no hay inscripción ONCAE" }],
  "pa-logistica-istmo": [{ campo_id: "p04", valor: "Cra 7 # 71-21 Of 1203, Bogotá D.C.", motivo: "Dirección abreviada a ≤ 40 caracteres" }],
};

/** Expectativas por caso con fecha de referencia 2026-11-19. */
const ESPERADO: Record<string, { estado: "LISTO_PARA_FIRMA" | "BORRADOR"; hallazgos: string[] }> = {
  "co-industrias-delta": { estado: "LISTO_PARA_FIRMA", hallazgos: [] },
  "ec-corp-andina": { estado: "LISTO_PARA_FIRMA", hallazgos: ["CONVERSION_MONEDA", "INSTRUCCION_EN_DOCUMENTO_CLIENTE", "SOPORTE_VENCE_ANTES_DE_ENTREGA"] },
  "hn-agroexport-sula": { estado: "BORRADOR", hallazgos: ["SOPORTE_FALTANTE"] },
  "pa-logistica-istmo": { estado: "BORRADOR", hallazgos: ["SOPORTE_VENCIDO"] },
};

interface Registro { herramienta: string; entrada: unknown; ok: boolean; error?: unknown }

async function correr(dirSalida: string, silencioso = false) {
  const p = silencioso ? () => {} : log;
  await rm(dirSalida, { recursive: true, force: true });
  await mkdir(dirSalida, { recursive: true });
  const almacen = new AlmacenSesiones(() => `${FECHA}T12:00:00.000Z`);
  const ctx: ContextoHerramientas = { fixtures: new Fixtures(FIXTURES), sesion: almacen.obtener("demo"), fechaReferencia: FECHA, dirSalida, urlDescarga: (r) => relative(dirSalida, r) };
  const traza: Registro[] = [];
  const fallos: string[] = [];
  const llamar = async (h: string, e: unknown): Promise<ResultadoHerramienta> => {
    const r = await ejecutarHerramienta(h, e, ctx);
    traza.push({ herramienta: h, entrada: e, ok: r.ok, ...(r.error ? { error: r.error } : {}) });
    return r;
  };
  const esperar = (cond: boolean, msg: string) => { if (!cond) fallos.push(msg); p(`   ${cond ? C.g + "✔" : C.r + "✘"} ${msg}${C.x}`); };

  const lista = (await llamar("listar_casos", {})).datos as { casos: { caso_id: string; cliente: string; pais: string; formato: string }[] };
  const casos = lista.casos.filter((c) => !args.caso || c.caso_id === args.caso);
  const resultados: Record<string, unknown>[] = [];

  for (const caso of casos) {
    const id = caso.caso_id;
    p(`\n${C.b}${C.c}▶ ${id}${C.x} ${C.d}${caso.cliente} · ${caso.pais} · ${caso.formato.toUpperCase()}${C.x}`);
    await llamar("leer_solicitud", { caso_id: id });

    const mapeo = (await llamar("mapear_campos", { caso_id: id })).datos as { campos: { id: string; etiqueta: string; metodo: string; valor: string | null; estado: string }[] };
    for (const c of mapeo.campos) {
      const color = c.estado === "ok" ? (c.valor ? C.g : C.d) : C.y;
      p(`   ${color}${c.id.padEnd(4)} ${c.etiqueta.padEnd(42).slice(0, 42)} ${c.metodo.padEnd(10)} ${c.valor ?? "—"}${C.x}`);
    }
    const sop = (await llamar("verificar_soportes", { caso_id: id })).datos as { soportes: { tipo: string; estado: string; documento?: { id: string }; vigencia_aplicable_dias?: number; dias_transcurridos?: number }[] };
    for (const s of sop.soportes) {
      const color = s.estado === "vigente" ? C.g : C.r;
      p(`   ${color}📎 ${String(s.tipo).padEnd(26)} ${s.estado.padEnd(9)} ${s.documento?.id ?? ""} ${s.dias_transcurridos !== undefined ? `(${s.dias_transcurridos}/${s.vigencia_aplicable_dias} días)` : ""}${C.x}`);
    }

    // Intervención humana simulada para pendientes que el humano puede resolver
    for (const r of RESPUESTAS_HUMANAS[id] ?? []) {
      p(`   ${C.y}👤 Humano (simulado): ${r.campo_id} = "${r.valor}" — ${r.motivo}${C.x}`);
      await llamar("registrar_valor_manual", { caso_id: id, ...r });
    }

    const val = (await llamar("validar_datos", { caso_id: id })).datos as { resumen: { bloqueantes: number; advertencias: number; puede_paquete_final: boolean }; hallazgos: { codigo: string; severidad: string; mensaje: string }[] };
    for (const h of val.hallazgos) p(`   ${h.severidad === "bloqueante" ? C.r + "⛔" : h.severidad === "advertencia" ? C.y + "⚠ " : C.d + "ℹ "} ${h.codigo}: ${h.mensaje}${C.x}`);

    const prev = (await llamar("llenar_formulario", { caso_id: id })).datos as { campos_llenados: number };
    const modo = val.resumen.puede_paquete_final ? "final" : "borrador";

    // Robustez: modo final con bloqueantes debe ser rechazado por la herramienta
    if (!val.resumen.puede_paquete_final) {
      const r = await llamar("solicitar_confirmacion_humana", { caso_id: id, modo: "final", resumen: "Intento indebido de paquete final" });
      esperar(!r.ok && r.error?.codigo === "FINAL_NO_PERMITIDO", "Herramienta rechaza paquete FINAL cuando hay bloqueantes");
    }
    const conf = await llamar("solicitar_confirmacion_humana", { caso_id: id, modo, resumen: `Armar paquete ${modo} para ${caso.cliente}: ${val.resumen.bloqueantes} bloqueantes, ${val.resumen.advertencias} advertencias.` });
    const confId = conf.confirmacion_requerida!.id;

    // Robustez: armar sin aprobación humana debe fallar
    const sinAprobar = await llamar("armar_paquete", { caso_id: id, confirmacion_id: confId });
    esperar(!sinAprobar.ok && sinAprobar.error?.codigo === "CONFIRMACION_NO_APROBADA", "armar_paquete bloqueado sin aprobación humana");

    p(`   ${C.y}👤 Humano (simulado): APRUEBA ${confId}${C.x}`);
    ctx.sesion.decidir(confId, "aprobar", "revisor-demo", "Aprobación simulada en demo.ts");
    const paq = await llamar("armar_paquete", { caso_id: id, confirmacion_id: confId });
    const d = paq.datos as { estado: string; descarga_zip: string; archivos: { nombre: string }[] };

    // Robustez: la confirmación es de un solo uso
    const reuso = await llamar("armar_paquete", { caso_id: id, confirmacion_id: confId });
    esperar(!reuso.ok, "La confirmación no se puede reutilizar");

    const exp = ESPERADO[id];
    if (exp) {
      esperar(d.estado === exp.estado, `Estado del paquete = ${exp.estado} (obtenido ${d.estado})`);
      for (const cod of exp.hallazgos) esperar(val.hallazgos.some((h) => h.codigo === cod), `Detecta ${cod}`);
    }
    if (id === "co-industrias-delta") {
      esperar(sop.soportes.find((s) => s.tipo === "certificado_parafiscales")?.documento?.id === "SOP-PF-2026-11", "Elige la versión más reciente de parafiscales (SOP-PF-2026-11)");
    }
    if (id === "ec-corp-andina") {
      esperar(mapeo.campos.find((c) => c.id === "e02")?.valor === "900123456-8", "Sin casilla DV → reporta NIT con DV (900123456-8)");
      esperar(mapeo.campos.find((c) => c.id === "e07")?.valor === "4,610,764.27", "Activos convertidos a USD con TRM del repositorio (4,610,764.27)");
    }
    p(`   ${d.estado === "LISTO_PARA_FIRMA" ? C.g : C.y}📦 ${d.estado}${C.x} → ${relative(process.cwd(), join(dirSalida, d.descarga_zip))} (${d.archivos.length} archivos, ${prev.campos_llenados} campos llenados)`);
    resultados.push({ caso_id: id, estado: d.estado, modo, bloqueantes: val.resumen.bloqueantes, advertencias: val.resumen.advertencias, zip: d.descarga_zip, hallazgos: val.hallazgos.map((h) => h.codigo) });
  }

  // Robustez de entrada: zod rechaza ids maliciosos
  const malo = await llamar("leer_solicitud", { caso_id: "../../etc/passwd" });
  esperar(!malo.ok && malo.error?.codigo === "ENTRADA_INVALIDA", "zod rechaza caso_id con path traversal");
  const inexistente = await llamar("leer_solicitud", { caso_id: "xx-no-existe" });
  esperar(!inexistente.ok && inexistente.error?.codigo === "CASO_NO_EXISTE", "Caso inexistente → error tipado");

  await writeFile(join(dirSalida, "reporte-demo.json"), JSON.stringify({ fecha_referencia: FECHA, resultados, traza, fallos }, null, 2));
  return { resultados, fallos };
}

async function hashes(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const recorrer = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const r = join(d, e.name);
      if (e.isDirectory()) await recorrer(r);
      else out[relative(dir, r)] = createHash("sha256").update(await readFile(r)).digest("hex");
    }
  };
  await recorrer(dir);
  return out;
}

log(`${C.b}Demo determinista · Reto 1 · fecha de referencia ${FECHA}${C.x} ${C.d}(sin LLM: llamadas directas a src/tools/proveedor.ts)${C.x}`);
const salida = join(DIR, "output", "demo");
const { resultados, fallos } = await correr(salida);

if (args.check) {
  log(`\n${C.b}Prueba de determinismo:${C.x} segunda corrida en output/demo-check …`);
  const salida2 = join(DIR, "output", "demo-check");
  await correr(salida2, true);
  const [h1, h2] = [await hashes(salida), await hashes(salida2)];
  const difs = Object.keys({ ...h1, ...h2 }).filter((k) => h1[k] !== h2[k]);
  if (difs.length) { fallos.push(`Archivos distintos entre corridas: ${difs.join(", ")}`); log(`${C.r}✘ ${difs.length} archivo(s) difieren${C.x}`); }
  else log(`${C.g}✔ ${Object.keys(h1).length} archivos idénticos byte a byte entre las dos corridas${C.x}`);
  await rm(salida2, { recursive: true, force: true });
}

log(`\n${C.b}Resumen${C.x}`);
console.table(resultados.map((r) => ({ caso: r.caso_id, estado: r.estado, bloqueantes: r.bloqueantes, advertencias: r.advertencias })));
if (fallos.length) {
  log(`${C.r}${C.b}✘ ${fallos.length} verificación(es) fallaron:${C.x}\n - ${fallos.join("\n - ")}`);
  process.exit(1);
}
log(`${C.g}${C.b}✔ Todas las verificaciones pasaron.${C.x} Reporte: output/demo/reporte-demo.json`);
