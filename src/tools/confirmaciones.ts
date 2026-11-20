/**
 * Confirmación humana (CA3 / RN4), aplicada en código y no solo en el prompt.
 *
 *   turno N   : proveedor_armar_paquete marca el caso como "pendiente de confirmación"
 *               → el turno termina con needsConfirmation = true y una pregunta explícita.
 *   turno N+1 : el backend registra el mensaje del usuario ANTES de llamar al modelo.
 *               Si es una confirmación explícita, el caso queda confirmado SOLO durante ese turno.
 *               Cualquier otro mensaje descarta la confirmación pendiente.
 *   proveedor_simular_envio exige confirmado=true Y la confirmación registrada.
 *
 * Estado en memoria por sesión (el PRD no exige persistencia).
 */
import { reglas } from "../core/reglas";
import { normalizar } from "../core/texto";

const pendientes = new Map<string, Set<string>>();
const confirmados = new Map<string, Set<string>>();

const contiene = (texto: string, frases: string[]) => frases.some((f) => new RegExp(`(^| )${normalizar(f)}( |$)`).test(texto));

/** "sí", "confirmo", "envía" → true · "no envíes nada todavía", "espera" → false. */
export function esConfirmacion(mensaje: string): boolean {
  const t = normalizar(mensaje);
  return !contiene(t, reglas.confirmacion.negativas) && contiene(t, reglas.confirmacion.afirmativas);
}

export function solicitarConfirmacion(sessionId: string, caso: string): void {
  const s = pendientes.get(sessionId) ?? new Set<string>();
  s.add(caso);
  pendientes.set(sessionId, s);
}

export function pendientesDeConfirmacion(sessionId: string): string[] {
  return [...(pendientes.get(sessionId) ?? [])];
}

/** Llamar con cada mensaje del usuario, antes de ejecutar el turno. */
export function registrarMensajeUsuario(sessionId: string, mensaje: string): { confirmo: boolean; casos: string[] } {
  const espera = [...(pendientes.get(sessionId) ?? [])];
  pendientes.delete(sessionId);
  confirmados.delete(sessionId);
  if (!espera.length || !esConfirmacion(mensaje)) return { confirmo: false, casos: [] };
  const nombrados = espera.filter((c) => mensaje.toLowerCase().includes(c));
  const casos = nombrados.length ? nombrados : espera;
  confirmados.set(sessionId, new Set(casos));
  return { confirmo: true, casos };
}

export function estaConfirmado(sessionId: string, caso: string): boolean {
  return confirmados.get(sessionId)?.has(caso) ?? false;
}

export function consumirConfirmacion(sessionId: string, caso: string): void {
  confirmados.get(sessionId)?.delete(caso);
}

export function reiniciarSesion(sessionId: string): void {
  pendientes.delete(sessionId);
  confirmados.delete(sessionId);
}
