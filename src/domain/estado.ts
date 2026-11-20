/**
 * Estado mínimo por sesión: valores aportados por el humano y confirmaciones (human-in-the-loop).
 * Todo lo demás (mapeo, validaciones, vigencias) se RECALCULA en cada llamada a partir de los
 * insumos → las herramientas son idempotentes y deterministas.
 *
 * La confirmación humana se hace cumplir en el BACKEND, no en el prompt: el modelo no puede
 * "aprobarse a sí mismo" porque solo el endpoint HTTP del humano cambia el estado a "aprobada".
 */
import { createHash } from "node:crypto";

export type EstadoConfirmacion = "pendiente" | "aprobada" | "rechazada" | "consumida" | "invalidada";

export interface Confirmacion {
  id: string;
  caso_id: string;
  modo: "final" | "borrador";
  resumen: string;
  huella: string;
  estado: EstadoConfirmacion;
  decidida_por?: string;
  comentario?: string;
  creada_en: string;
  decidida_en?: string;
}

export interface ValorManual {
  valor: string;
  registrado_por: string;
  registrado_en: string;
}

export class Sesion {
  readonly valoresManuales = new Map<string, Record<string, ValorManual>>();
  readonly confirmaciones = new Map<string, Confirmacion>();
  private contador = 0;
  readonly auditoria: { ts: string; evento: string; detalle: unknown }[] = [];

  constructor(readonly id: string, private reloj: () => string) {}

  ahora() {
    return this.reloj();
  }

  registrar(evento: string, detalle: unknown) {
    this.auditoria.push({ ts: this.ahora(), evento, detalle });
  }

  manuales(casoId: string): Record<string, ValorManual> {
    return this.valoresManuales.get(casoId) ?? {};
  }

  fijarManual(casoId: string, campoId: string, valor: string, por: string) {
    const actual = { ...this.manuales(casoId), [campoId]: { valor, registrado_por: por, registrado_en: this.ahora() } };
    this.valoresManuales.set(casoId, actual);
    // Cambiar datos invalida aprobaciones previas del caso (la huella ya no coincide).
    for (const c of this.confirmaciones.values()) {
      if (c.caso_id === casoId && (c.estado === "pendiente" || c.estado === "aprobada")) c.estado = "invalidada";
    }
    this.registrar("valor_manual", { casoId, campoId, valor, por });
  }

  crearConfirmacion(casoId: string, modo: "final" | "borrador", resumen: string, huella: string): Confirmacion {
    this.contador += 1;
    const id = `CONF-${casoId}-${String(this.contador).padStart(3, "0")}`;
    const c: Confirmacion = { id, caso_id: casoId, modo, resumen, huella, estado: "pendiente", creada_en: this.ahora() };
    this.confirmaciones.set(id, c);
    this.registrar("confirmacion_solicitada", { id, casoId, modo });
    return c;
  }

  /** Solo invocable desde la interfaz humana (endpoint HTTP) o, en demo.ts, de forma explícita. */
  decidir(id: string, decision: "aprobar" | "rechazar", por: string, comentario?: string): Confirmacion {
    const c = this.confirmaciones.get(id);
    if (!c) throw new Error(`Confirmación ${id} no existe`);
    if (c.estado !== "pendiente") throw new Error(`Confirmación ${id} no está pendiente (estado: ${c.estado})`);
    c.estado = decision === "aprobar" ? "aprobada" : "rechazada";
    c.decidida_por = por;
    c.comentario = comentario;
    c.decidida_en = this.ahora();
    this.registrar("confirmacion_decidida", { id, decision, por, comentario });
    return c;
  }
}

export class AlmacenSesiones {
  private sesiones = new Map<string, Sesion>();
  constructor(private reloj: () => string = () => new Date().toISOString()) {}

  obtener(id: string): Sesion {
    let s = this.sesiones.get(id);
    if (!s) {
      s = new Sesion(id, this.reloj);
      this.sesiones.set(id, s);
    }
    return s;
  }
}

export function huella(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
}
