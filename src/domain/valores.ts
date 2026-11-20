/**
 * Resolución de valores maestros (directos y derivados) y su formateo según la plantilla del cliente.
 * Regla de oro: si no hay dato en el repositorio, NO se inventa — se devuelve null y se reporta.
 */
import { calcularDvNit, formatearFecha, formatearNumero, redondear } from "./reglas";
import type { CampoPlantilla, RepositorioMaestro, Solicitud } from "./tipos";

export type ValorCrudo = string | number | string[];

export interface ValorResuelto {
  crudo: ValorCrudo;
  fuente: "repositorio" | "derivado";
  ruta: string;
  nota?: string;
}

type Getter = (r: RepositorioMaestro, ctx: { fechaReferencia: string }) => ValorResuelto | null;

const dir = (ruta: string, f: (r: RepositorioMaestro) => ValorCrudo): Getter => (r) => ({ crudo: f(r), fuente: "repositorio", ruta });
const der = (ruta: string, f: Getter): Getter => f;

/** Claves maestras soportadas. Extender aquí cuando el PRD agregue claves nuevas. */
export const CLAVES: Record<string, Getter> = {
  razon_social: dir("empresa.razon_social", (r) => r.empresa.razon_social),
  nit: dir("empresa.nit", (r) => r.empresa.nit),
  nit_dv: dir("empresa.nit_dv", (r) => r.empresa.nit_dv),
  nit_completo: der("empresa.nit+nit_dv", (r) => ({ crudo: `${r.empresa.nit}-${r.empresa.nit_dv}`, fuente: "derivado", ruta: "empresa.nit + empresa.nit_dv" })),
  tipo_sociedad: dir("empresa.tipo_sociedad", (r) => r.empresa.tipo_sociedad),
  fecha_constitucion: dir("empresa.fecha_constitucion", (r) => r.empresa.fecha_constitucion),
  matricula_mercantil: dir("empresa.matricula_mercantil", (r) => r.empresa.matricula_mercantil),
  ciiu: dir("empresa.ciiu", (r) => `${r.empresa.ciiu} - ${r.empresa.ciiu_descripcion}`),
  regimen_tributario: dir("empresa.regimen_tributario", (r) => r.empresa.regimen_tributario),
  direccion: dir("empresa.direccion", (r) => r.empresa.direccion),
  ciudad: dir("empresa.ciudad", (r) => r.empresa.ciudad),
  pais: dir("empresa.pais", (r) => r.empresa.pais),
  telefono: dir("empresa.telefono", (r) => r.empresa.telefono),
  email_notificaciones: dir("empresa.email_notificaciones", (r) => r.empresa.email_notificaciones),
  sitio_web: dir("empresa.sitio_web", (r) => r.empresa.sitio_web),
  numero_empleados: dir("empresa.numero_empleados", (r) => r.empresa.numero_empleados),
  certificaciones: dir("empresa.certificaciones", (r) => r.empresa.certificaciones),
  rep_legal_nombre: dir("representante_legal.nombre", (r) => r.representante_legal.nombre),
  rep_legal_tipo_doc: dir("representante_legal.tipo_documento", (r) => r.representante_legal.tipo_documento),
  rep_legal_documento: dir("representante_legal.numero_documento", (r) => `${r.representante_legal.tipo_documento} ${r.representante_legal.numero_documento}`),
  rep_legal_cargo: dir("representante_legal.cargo", (r) => r.representante_legal.cargo),
  rep_legal_email: dir("representante_legal.email", (r) => r.representante_legal.email),
  banco_entidad: dir("bancario.entidad", (r) => r.bancario.entidad),
  banco_tipo_cuenta: dir("bancario.tipo_cuenta", (r) => r.bancario.tipo_cuenta),
  banco_numero_cuenta: dir("bancario.numero_cuenta", (r) => r.bancario.numero_cuenta),
  banco_titular: dir("bancario.titular", (r) => r.bancario.titular),
  banco_swift: dir("bancario.codigo_swift", (r) => r.bancario.codigo_swift),
  anio_fiscal: dir("financiero.anio_fiscal", (r) => String(r.financiero.anio_fiscal)),
  activos_totales: dir("financiero.activos_totales", (r) => r.financiero.activos_totales),
  activo_corriente: dir("financiero.activo_corriente", (r) => r.financiero.activo_corriente),
  pasivos_totales: dir("financiero.pasivos_totales", (r) => r.financiero.pasivos_totales),
  pasivo_corriente: dir("financiero.pasivo_corriente", (r) => r.financiero.pasivo_corriente),
  patrimonio: dir("financiero.patrimonio", (r) => r.financiero.patrimonio),
  ingresos_operacionales: dir("financiero.ingresos_operacionales", (r) => r.financiero.ingresos_operacionales),
  utilidad_neta: dir("financiero.utilidad_neta", (r) => r.financiero.utilidad_neta),
  indice_liquidez: der("financiero", (r) => ({
    crudo: redondear(r.financiero.activo_corriente / r.financiero.pasivo_corriente, 4),
    fuente: "derivado",
    ruta: "financiero.activo_corriente / financiero.pasivo_corriente",
  })),
  nivel_endeudamiento: der("financiero", (r) => ({
    crudo: redondear(r.financiero.pasivos_totales / r.financiero.activos_totales, 4),
    fuente: "derivado",
    ruta: "financiero.pasivos_totales / financiero.activos_totales",
  })),
  fecha_diligenciamiento: der("contexto", (_r, ctx) => ({ crudo: ctx.fechaReferencia, fuente: "derivado", ruta: "fecha de referencia del proceso" })),
};

/** Claves cuyo valor es monetario en la moneda del repositorio (sujetas a conversión). */
export const CLAVES_MONETARIAS = new Set(["activos_totales", "activo_corriente", "pasivos_totales", "pasivo_corriente", "patrimonio", "ingresos_operacionales", "utilidad_neta"]);
export const CLAVES_FECHA = new Set(["fecha_constitucion", "fecha_diligenciamiento"]);

export function resolverClave(clave: string, repo: RepositorioMaestro, fechaReferencia: string): ValorResuelto | null {
  const g = CLAVES[clave];
  return g ? g(repo, { fechaReferencia }) : null;
}

export interface Formateado {
  texto: string;
  nota?: string;
  error?: { codigo: string; mensaje: string };
}

/** Convierte un valor crudo al texto final que va en la celda/campo, según formato, moneda y locale. */
export function formatear(
  clave: string,
  valor: ValorResuelto,
  campo: CampoPlantilla,
  sol: Solicitud,
  repo: RepositorioMaestro,
): Formateado {
  const { crudo } = valor;
  const locale = sol.locale;

  if (CLAVES_MONETARIAS.has(clave)) {
    let n = crudo as number;
    let nota: string | undefined;
    const origen = repo.financiero.moneda;
    const destino = sol.moneda_reporte;
    if (origen !== destino) {
      const tasaDestino = repo.tasas_cambio[destino];
      if (!tasaDestino) {
        return { texto: "", error: { codigo: "TASA_CAMBIO_NO_DISPONIBLE", mensaje: `No hay tasa de cambio ${origen}→${destino} en el repositorio` } };
      }
      n = redondear(n / tasaDestino.valor, 2);
      nota = `Convertido ${origen}→${destino} con tasa ${tasaDestino.valor} (${tasaDestino.fecha}, ${tasaDestino.fuente})`;
    }
    return { texto: formatearNumero(n, destino === "COP" ? 0 : 2, locale), nota };
  }

  if (CLAVES_FECHA.has(clave) || campo.formato === "fecha") {
    if (typeof crudo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(crudo)) return { texto: formatearFecha(crudo, sol.formato_fecha) };
  }

  if (campo.formato === "porcentaje" && typeof crudo === "number") return { texto: formatearNumero(crudo * 100, 2, locale) + " %" };
  if (campo.formato === "decimal2" && typeof crudo === "number") return { texto: formatearNumero(crudo, 2, locale) };
  if (campo.formato === "numero" && typeof crudo === "number") return { texto: formatearNumero(crudo, 0, locale) };
  if (Array.isArray(crudo)) return { texto: crudo.join(", ") };
  return { texto: String(crudo) };
}

export function verificarIntegridadNit(repo: RepositorioMaestro): { ok: boolean; esperado: string } {
  const esperado = calcularDvNit(repo.empresa.nit);
  return { ok: esperado === repo.empresa.nit_dv, esperado };
}
