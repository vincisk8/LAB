/**
 * Modo simulado (sin LLM): un planificador determinista que recorre el mismo ciclo que seguiría el
 * modelo y emite los mismos eventos. Sirve para (a) probar la URL pública sin API key ni costo,
 * (b) tener un plan B durante la defensa técnica si el proveedor de LLM falla.
 * No entiende lenguaje libre: reconoce casos por nombre/país, "campo = valor" y aprobaciones.
 */
import type { ContextoHerramientas } from "../tools/proveedor";
import { ejecutarHerramienta } from "../tools/proveedor";
import type { Agente, Evento } from "./eventos";

const PALABRAS: Record<string, string[]> = {
  "co-industrias-delta": ["delta", "colombia", "industrias"],
  "ec-corp-andina": ["andina", "ecuador", "corp"],
  "hn-agroexport-sula": ["sula", "honduras", "agroexport"],
  "pa-logistica-istmo": ["istmo", "panama", "panamá", "logistica", "logística"],
};

type Datos = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class AgenteSimulado implements Agente {
  private casoActual = new Map<string, string>();
  constructor(private crearContexto: (sesionId: string) => ContextoHerramientas) {}

  reiniciar(sesionId: string) {
    this.casoActual.delete(sesionId);
  }

  async *turno(sesionId: string, mensaje: string): AsyncGenerator<Evento> {
    const ctx = this.crearContexto(sesionId);
    const m = mensaje.toLowerCase();
    let n = 0;
    const llamar = async function* (nombre: string, entrada: Datos): AsyncGenerator<Evento, Datos | null> {
      const id = `sim_${++n}`;
      yield { tipo: "herramienta_inicio", id, nombre, entrada };
      const t0 = performance.now();
      const r = await ejecutarHerramienta(nombre, entrada, ctx);
      yield { tipo: "herramienta_fin", id, nombre, ok: r.ok, resultado: r.ok ? r.datos : r.error, ms: Math.round(performance.now() - t0) };
      if (r.confirmacion_requerida) yield { tipo: "confirmacion", confirmacion: r.confirmacion_requerida };
      return r.ok ? (r.datos as Datos) : { __error: r.error };
    };

    // 1) Decisión humana sobre una confirmación
    const conf = mensaje.match(/CONF-[a-z0-9-]+-\d{3}/i)?.[0];
    if (conf && /aprob|apruebo|✅/i.test(mensaje)) {
      const caso = conf.replace(/^CONF-/, "").replace(/-\d{3}$/, "");
      const d = yield* llamar("armar_paquete", { caso_id: caso, confirmacion_id: conf });
      if (d?.__error) yield { tipo: "texto", texto: `⛔ No pude armar el paquete: ${d.__error.mensaje}` };
      else {
        const lineas = (d!.archivos as Datos[]).map((f) => `- [${f.nombre}](${f.descarga})`).join("\n");
        yield {
          tipo: "texto",
          texto: `${d!.estado === "LISTO_PARA_FIRMA" ? "✅ **Paquete listo para firma**" : "📝 **Borrador generado (NO FIRMAR)**"}\n\n📦 [Descargar ZIP](${d!.descarga_zip})\n\n${lineas}${(d!.pendientes as string[]).length ? `\n\n**Pendientes:**\n${(d!.pendientes as string[]).map((p) => `- ${p}`).join("\n")}` : ""}`,
        };
      }
      return yield* this.cerrar();
    }
    if (conf && /rechaz|❌/i.test(mensaje)) {
      yield { tipo: "texto", texto: "Entendido, no armo el paquete. Dime qué quieres ajustar (por ejemplo `p04 = nueva dirección`)." };
      return yield* this.cerrar();
    }

    // 2) Asignación "campo = valor" sobre el caso actual
    const asign = mensaje.match(/\b([a-z]\d{2})\s*[=:]\s*(.+)$/i);
    const actual = this.casoActual.get(sesionId);
    if (asign && actual) {
      const d = yield* llamar("registrar_valor_manual", { caso_id: actual, campo_id: asign[1]!.toLowerCase(), valor: asign[2]!.trim().replace(/^["']|["']$/g, "") });
      if (d?.__error) {
        yield { tipo: "texto", texto: `⛔ ${d.__error.mensaje}` };
        return yield* this.cerrar();
      }
      return yield* this.procesarCaso(actual, llamar);
    }

    // 3) Identificar caso
    const caso = Object.entries(PALABRAS).find(([id, ps]) => m.includes(id) || ps.some((p) => m.includes(p)))?.[0];
    if (caso) {
      this.casoActual.set(sesionId, caso);
      return yield* this.procesarCaso(caso, llamar);
    }

    // 4) Por defecto: listar
    const d = yield* llamar("listar_casos", {});
    const filas = (d!.casos as Datos[]).map((c) => `| \`${c.caso_id}\` | ${c.cliente} | ${c.pais} | ${String(c.formato).toUpperCase()} | ${c.fecha_limite} |`).join("\n");
    yield {
      tipo: "texto",
      texto: `Estas son las solicitudes disponibles (fecha de referencia ${d!.fecha_referencia}):\n\n| Caso | Cliente | País | Formato | Límite |\n|---|---|---|---|---|\n${filas}\n\nDime cuál procesar, por ejemplo: «Procesa la solicitud de Panamá».`,
    };
    return yield* this.cerrar();
  }

  private async *procesarCaso(caso: string, llamar: (n: string, e: Datos) => AsyncGenerator<Evento, Datos | null>): AsyncGenerator<Evento> {
    const sol = (yield* llamar("leer_solicitud", { caso_id: caso }))!;
    const map = (yield* llamar("mapear_campos", { caso_id: caso }))!;
    yield* llamar("verificar_soportes", { caso_id: caso });
    const val = (yield* llamar("validar_datos", { caso_id: caso }))!;
    const hall = val.hallazgos as Datos[];
    const icon = (s: string) => (s === "bloqueante" ? "⛔" : s === "advertencia" ? "⚠️" : "ℹ️");
    const listaHall = hall.map((h) => `- ${icon(h.severidad)} **${h.codigo}**: ${h.mensaje}`).join("\n");
    const r = val.resumen;

    const pendientesHumanos = (map.campos as Datos[]).filter((c) => c.estado === "pendiente");
    if (pendientesHumanos.length) {
      const filas = pendientesHumanos.map((c) => `| \`${c.id}\` | ${c.etiqueta} | ${c.valor ?? "—"} |`).join("\n");
      yield {
        tipo: "texto",
        texto: `**${sol.cliente.razon_social}** (${sol.cliente.pais}). Antes de seguir necesito tu ayuda con ${pendientesHumanos.length} campo(s):\n\n| Campo | Etiqueta | Valor actual |\n|---|---|---|\n${filas}\n\nResponde con el formato \`campo = valor\` (por ejemplo \`${pendientesHumanos[0]!.id} = ...\`).\n\n**Hallazgos:**\n${listaHall}`,
      };
      return yield* this.cerrar();
    }

    const prev = (yield* llamar("llenar_formulario", { caso_id: caso }))!;
    const modo = r.puede_paquete_final ? "final" : "borrador";
    const estado = r.bloqueantes ? "⛔ **Bloqueado: solo se puede generar borrador**" : r.advertencias ? "⚠️ **Listo con advertencias**" : "✅ **Listo para firma**";
    yield {
      tipo: "texto",
      texto: `${estado}\n\n**${sol.cliente.razon_social}** · ${sol.cliente.pais} · límite ${sol.fecha_limite_entrega}\n- Campos diligenciados: ${r.campos_ok}/${r.campos_total}\n- Soportes vigentes: ${r.soportes_vigentes}/${r.soportes_vigentes + r.soportes_con_problema}\n- 👁️ [Vista previa del formulario](${prev.descarga})\n\n${listaHall || "Sin hallazgos."}`,
    };
    const resumen = `Paquete ${modo.toUpperCase()} para ${sol.cliente.razon_social}: ${r.campos_ok}/${r.campos_total} campos, ${r.soportes_vigentes} soportes vigentes, ${r.bloqueantes} bloqueante(s), ${r.advertencias} advertencia(s).`;
    yield* llamar("solicitar_confirmacion_humana", { caso_id: caso, modo, resumen });
    yield* this.cerrar();
  }

  private async *cerrar(): AsyncGenerator<Evento> {
    yield { tipo: "uso", modelo: "simulado (sin LLM)", iteraciones: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, costo_usd: 0 };
    yield { tipo: "fin" };
  }
}
