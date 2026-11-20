/** Eventos que el backend emite por SSE al frontend durante un turno del agente. */
export type Evento =
  | { tipo: "texto"; texto: string }
  | { tipo: "herramienta_inicio"; id: string; nombre: string; entrada: unknown }
  | { tipo: "herramienta_fin"; id: string; nombre: string; ok: boolean; resultado: unknown; ms: number }
  | { tipo: "confirmacion"; confirmacion: { id: string; caso_id: string; modo: "final" | "borrador"; resumen: string } }
  | { tipo: "uso"; modelo: string; iteraciones: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; costo_usd: number }
  | { tipo: "error"; mensaje: string }
  | { tipo: "fin" };

export interface Agente {
  turno(sesionId: string, mensaje: string): AsyncGenerator<Evento>;
  reiniciar(sesionId: string): void;
}
