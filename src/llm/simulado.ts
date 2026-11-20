/**
 * Adaptador "simulado": un planificador determinista que implementa la misma interfaz que un LLM.
 * Permite probar el chat y el ciclo sin clave ni costo (y es el plan B en la defensa).
 * Solo entiende: nombres de caso, confirmaciones ("sí", "envía") y el flujo estándar.
 */
import { z } from "zod";
import type { AdaptadorLLM, DefinicionHerramienta, LlamadaHerramienta, Mensaje, RespuestaLLM } from "./adapter";

const RE_CASO = /\b([a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)+)\b/;
const AFIRMA = /(^|\s)(si|sí|confirmo|confirmado|envia|envía|envialo|envíalo|procede|adelante|dale|ok)(\s|[.,!]|$)/i;
const NIEGA = /(^|\s)(no|nada|todav[ií]a|a[uú]n|espera|cancela)(\s|[.,!]|$)/i;

const Resultado = z.object({ ok: z.boolean(), data: z.record(z.string(), z.unknown()).optional(), error: z.string().optional() });
type Resultado = z.infer<typeof Resultado>;

const sinUso = { entrada: 0, salida: 0, cache_lectura: 0, cache_escritura: 0 };
let contador = 0;

function llamar(nombre: string, argumentos: Record<string, unknown>): RespuestaLLM {
  contador += 1;
  return { texto: "", llamadas: [{ id: `sim_${contador}`, nombre, argumentos }], uso: sinUso };
}
const decir = (texto: string): RespuestaLLM => ({ texto, llamadas: [], uso: sinUso });

/** Busca hacia atrás el resultado y la llamada de una herramienta. */
function ultimo(mensajes: Mensaje[], nombre: string): { llamada: LlamadaHerramienta; resultado: Resultado } | null {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i]!;
    if (m.rol !== "tool") continue;
    const r = m.resultados.find((x) => x.nombre === nombre);
    if (!r) continue;
    const previo = mensajes.slice(0, i).reverse().find((x) => x.rol === "assistant");
    const llamada = previo?.rol === "assistant" ? previo.llamadas.find((l) => l.id === r.id) : undefined;
    const parsed = Resultado.safeParse(JSON.parse(r.contenido));
    if (llamada && parsed.success) return { llamada, resultado: parsed.data };
  }
  return null;
}

const casoDe = (l: LlamadaHerramienta) => (l.argumentos as { caso?: string }).caso ?? "";
const lista = (v: unknown) => (Array.isArray(v) ? v : []);

function resumenFinal(mensajes: Mensaje[]): RespuestaLLM {
  const paq = ultimo(mensajes, "proveedor_armar_paquete");
  const map = ultimo(mensajes, "proveedor_mapear_campos");
  const gen = ultimo(mensajes, "proveedor_generar_formulario");
  const sol = ultimo(mensajes, "proveedor_leer_solicitud");
  if (!paq) return decir("No pude armar el paquete.");
  const caso = casoDe(paq.llamada);
  if (!paq.resultado.ok) return decir(`⛔ No pude armar el paquete de \`${caso}\`: ${paq.resultado.error}`);
  const d = paq.resultado.data ?? {};
  const m = map?.resultado.data ?? {};
  const etiquetas = (v: unknown) => lista(v).map((x) => `- ${(x as { etiqueta: string }).etiqueta}${(x as { nota?: string }).nota ? `: ${(x as { nota: string }).nota}` : (x as { motivo?: string }).motivo ? `: ${(x as { motivo: string }).motivo}` : ""}`).join("\n") || "- Ninguno";
  const bloqueos = lista(d.bloqueos).map((b) => `- ${String(b)}`).join("\n");
  const formulario = gen?.resultado.ok ? `\`${String(gen.resultado.data?.ruta)}\`${gen.resultado.data?.mensaje ? ` (${String(gen.resultado.data.mensaje)})` : ""}` : `no generado (${gen?.resultado.error ?? "sin datos"})`;
  const destino = String(sol?.resultado.data?.de ?? "el cliente");
  return decir(
    `${d.listo_para_firma ? "✅ **Listo para firma**" : "⛔ **No listo para firma**"} · caso \`${caso}\`\n\n` +
      `- Formulario: ${formulario}\n- Paquete: \`${String(d.ruta)}\`\n\n` +
      `**Llenos:** ${lista(m.llenos).length}\n\n**Faltantes:**\n${etiquetas(m.faltantes)}\n\n**Requieren confirmación:**\n${etiquetas(m.requiere_confirmacion)}\n\n` +
      (bloqueos ? `**Soportes a actualizar / bloqueos:**\n${bloqueos}\n\n` : "") +
      `❓ **¿Confirmas que simule el envío del paquete de \`${caso}\` a ${destino}?** Responde «sí, envía» para continuar o cualquier otra cosa para no enviar.`,
  );
}

export class AdaptadorSimulado implements AdaptadorLLM {
  readonly proveedor = "simulado";
  readonly modelo = "planificador-determinista";

  async enviar(mensajes: Mensaje[], _h: DefinicionHerramienta[]): Promise<RespuestaLLM> {
    const fin = mensajes[mensajes.length - 1];
    if (!fin) return decir("Hola.");
    if (fin.rol === "user") return this.alUsuario(fin.texto, mensajes);
    if (fin.rol !== "tool") return decir("Listo.");
    const r = fin.resultados[0]!;
    const res = Resultado.safeParse(JSON.parse(r.contenido));
    const data = res.success ? (res.data.data ?? {}) : {};
    const previa = ultimo(mensajes, r.nombre);
    const caso = previa ? casoDe(previa.llamada) : String(data.caso ?? "");
    switch (r.nombre) {
      case "proveedor_listar_casos": {
        const filas = lista(data.casos).map((c) => { const x = c as Record<string, string>; return `| \`${x.caso}\` | ${x.cliente ?? x.error} | ${x.pais ?? ""} | ${x.formato ?? ""} |`; }).join("\n");
        return decir(`Solicitudes disponibles:\n\n| Caso | Cliente | País | Formato |\n|---|---|---|---|\n${filas}\n\nEscribe, por ejemplo: «Procesa el caso "ec-corp-andina"».`);
      }
      case "proveedor_leer_solicitud":
        if (!res.success || !res.data.ok) return decir(`⛔ ${res.success ? res.data.error : "Respuesta inválida"}`);
        return llamar("proveedor_mapear_campos", { caso, campos: lista(data.campos).map((c) => (c as { etiqueta: string }).etiqueta) });
      case "proveedor_mapear_campos":
        return llamar("proveedor_generar_formulario", { caso, mapeo: String(data.mapeo_id ?? "") });
      case "proveedor_generar_formulario":
        return llamar("proveedor_armar_paquete", { caso });
      case "proveedor_armar_paquete":
        return resumenFinal(mensajes);
      case "proveedor_simular_envio":
        return decir(res.success && res.data.ok ? `📨 Envío simulado registrado en \`${String(data.ruta)}\`. No se envió ningún correo real.` : `⛔ ${res.success ? res.data.error : "Error"}`);
      default:
        return decir("Listo.");
    }
  }

  private alUsuario(texto: string, mensajes: Mensaje[]): RespuestaLLM {
    const previo = ultimo(mensajes, "proveedor_armar_paquete");
    if (previo && AFIRMA.test(texto) && !NIEGA.test(texto)) return llamar("proveedor_simular_envio", { caso: casoDe(previo.llamada), confirmado: true });
    const caso = texto.toLowerCase().match(RE_CASO)?.[1];
    if (caso) return llamar("proveedor_leer_solicitud", { caso });
    return llamar("proveedor_listar_casos", {});
  }
}
