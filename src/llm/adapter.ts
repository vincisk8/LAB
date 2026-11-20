/**
 * Interfaz propia del proveedor de LLM (PRD §6.1): enviar(mensajes, herramientas) → respuesta.
 * El ciclo del agente solo conoce estos tipos; cambiar de proveedor = cambiar de implementación.
 */

export interface LlamadaHerramienta {
  id: string;
  nombre: string;
  argumentos: unknown;
}

export interface ResultadoHerramienta {
  id: string;
  nombre: string;
  contenido: string;
  esError: boolean;
}

export type Mensaje =
  | { rol: "system"; texto: string }
  | { rol: "user"; texto: string }
  | { rol: "assistant"; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: "tool"; resultados: ResultadoHerramienta[] };

export interface DefinicionHerramienta {
  nombre: string;
  descripcion: string;
  esquema: { type: "object"; [k: string]: unknown };
}

export interface Uso {
  entrada: number;
  salida: number;
  cache_lectura: number;
  cache_escritura: number;
}

export interface RespuestaLLM {
  texto: string;
  llamadas: LlamadaHerramienta[];
  uso: Uso;
}

export interface OpcionesEnvio {
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface AdaptadorLLM {
  readonly proveedor: string;
  readonly modelo: string;
  enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], opciones?: OpcionesEnvio): Promise<RespuestaLLM>;
}

/** Error del proveedor con mensaje apto para mostrar al usuario (sin claves ni trazas). */
export class ErrorLLM extends Error {}

export function mensajeHttp(proveedor: string, status: number): string {
  if (status === 401 || status === 403) return `${proveedor}: la clave de API no es válida o no tiene permisos.`;
  if (status === 429) return `${proveedor}: límite de uso alcanzado; espera un momento y reintenta.`;
  if (status >= 500) return `${proveedor}: el servicio no está disponible en este momento.`;
  return `${proveedor}: la petición fue rechazada (HTTP ${status}).`;
}
