/**
 * Esquemas zod de los insumos (fixtures). Validar los insumos al cargarlos evita que un
 * archivo mal formado llegue a las herramientas o al modelo: falla rápido y con mensaje claro.
 */
import { z } from "zod";

export const FormatoCampo = z.enum(["texto", "fecha", "moneda", "numero", "decimal2", "porcentaje", "lista"]);
export type FormatoCampo = z.infer<typeof FormatoCampo>;

export const CampoPlantilla = z.object({
  id: z.string(),
  etiqueta: z.string(),
  celda: z.string().regex(/^[A-Z]{1,3}\d{1,5}$/).optional(),
  campo_pdf: z.string().optional(),
  obligatorio: z.boolean().default(true),
  formato: FormatoCampo.default("texto"),
  max_longitud: z.number().int().positive().optional(),
});
export type CampoPlantilla = z.infer<typeof CampoPlantilla>;

export const Plantilla = z.object({
  formulario: z.string(),
  tipo: z.enum(["excel", "pdf"]),
  campos: z.array(CampoPlantilla).min(1),
});
export type Plantilla = z.infer<typeof Plantilla>;

export const SoporteRequerido = z.object({
  descripcion: z.string(),
  obligatorio: z.boolean().default(true),
  /** Opcional: si el cliente lo da explícito. Si no, se extrae del texto ("no mayor a 30 días"). */
  vigencia_max_dias: z.number().int().positive().optional(),
});
export type SoporteRequerido = z.infer<typeof SoporteRequerido>;

export const Solicitud = z.object({
  id: z.string(),
  radicado: z.string().optional(),
  cliente: z.object({
    razon_social: z.string(),
    pais: z.string(),
    codigo_pais: z.string().length(2),
    contacto: z.string().optional(),
  }),
  proceso: z.string(),
  fecha_solicitud: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fecha_limite_entrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  moneda_reporte: z.string().length(3).default("COP"),
  locale: z.enum(["es-CO", "en-US"]).default("es-CO"),
  formato_fecha: z.enum(["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY"]).default("DD/MM/YYYY"),
  formulario: z.object({
    tipo: z.enum(["excel", "pdf"]),
    archivo: z.string(),
    hoja: z.string().optional(),
    plantilla: z.string(),
  }),
  soportes_requeridos: z.array(SoporteRequerido),
  observaciones: z.string().optional(),
});
export type Solicitud = z.infer<typeof Solicitud>;

export const RepositorioMaestro = z.object({
  version: z.string(),
  actualizado: z.string(),
  empresa: z.object({
    razon_social: z.string(),
    nit: z.string(),
    nit_dv: z.string(),
    tipo_sociedad: z.string(),
    fecha_constitucion: z.string(),
    matricula_mercantil: z.string(),
    ciiu: z.string(),
    ciiu_descripcion: z.string(),
    regimen_tributario: z.string(),
    gran_contribuyente: z.boolean(),
    autorretenedor: z.boolean(),
    direccion: z.string(),
    ciudad: z.string(),
    departamento: z.string(),
    pais: z.string(),
    codigo_postal: z.string(),
    telefono: z.string(),
    email_notificaciones: z.string(),
    sitio_web: z.string(),
    numero_empleados: z.number(),
    certificaciones: z.array(z.string()),
  }),
  representante_legal: z.object({
    nombre: z.string(),
    tipo_documento: z.string(),
    numero_documento: z.string(),
    cargo: z.string(),
    email: z.string(),
    telefono: z.string(),
  }),
  contacto_comercial: z.object({ nombre: z.string(), cargo: z.string(), email: z.string(), telefono: z.string() }),
  bancario: z.object({
    entidad: z.string(),
    tipo_cuenta: z.string(),
    numero_cuenta: z.string(),
    titular: z.string(),
    codigo_swift: z.string(),
  }),
  financiero: z.object({
    anio_fiscal: z.number(),
    moneda: z.string(),
    activos_totales: z.number(),
    activo_corriente: z.number(),
    pasivos_totales: z.number(),
    pasivo_corriente: z.number(),
    patrimonio: z.number(),
    ingresos_operacionales: z.number(),
    utilidad_neta: z.number(),
  }),
  tasas_cambio: z.record(z.string(), z.object({ valor: z.number().positive(), fecha: z.string(), fuente: z.string() })),
});
export type RepositorioMaestro = z.infer<typeof RepositorioMaestro>;

export const SoporteIndice = z.object({
  id: z.string(),
  tipo: z.string(),
  nombre: z.string(),
  archivo: z.string(),
  fecha_emision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vigencia_dias: z.number().int().positive(),
});
export type SoporteIndice = z.infer<typeof SoporteIndice>;

export const IndiceVigencias = z.object({
  version: z.string(),
  descripcion: z.string().optional(),
  soportes: z.array(SoporteIndice),
});
export type IndiceVigencias = z.infer<typeof IndiceVigencias>;

export const Glosario = z.object({
  version: z.string(),
  descripcion: z.string().optional(),
  campos: z.record(z.string(), z.array(z.string())),
  soportes: z.record(z.string(), z.array(z.string())),
});
export type Glosario = z.infer<typeof Glosario>;

/** Severidad de un hallazgo. "bloqueante" impide generar el paquete final (solo borrador). */
export type Severidad = "bloqueante" | "advertencia" | "info";

export interface Hallazgo {
  codigo: string;
  severidad: Severidad;
  mensaje: string;
  campo_id?: string;
  soporte?: string;
}
