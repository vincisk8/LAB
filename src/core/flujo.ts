/** Pasos compuestos que comparten varias herramientas (sin estado: todo se recalcula desde los fixtures). */
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { escribirExcel, escribirPdf, escribirTexto, escribirValoresPortal, sinDatosBancarios, textoBorradorCorreo, textoChecklist, type FilaFormulario } from "./documentos";
import {
  ErrorInsumo,
  leerGlosario,
  leerIndiceSoportes,
  leerMaestro,
  leerPlantilla,
  leerSolicitud,
  leerSoportesExigidos,
  relativa,
  rutaOut,
  rutaPlantillaXlsx,
  rutaSoportes,
  valorEnRuta,
  type CampoPlantilla,
  type Solicitud,
} from "./insumos";
import { IndiceMapeo, mapear, valorParaFormulario, type Mapeo } from "./mapeo";
import { reglas } from "./reglas";
import { evaluarSoportes, type EstadoSoporte } from "./soportes";

export async function indiceDelCaso(directory: string, s: Solicitud): Promise<IndiceMapeo> {
  const maestro = await leerMaestro(directory);
  return new IndiceMapeo(await leerGlosario(directory, maestro), maestro, s.pais);
}

export async function mapearCaso(directory: string, caso: string, etiquetas?: string[]): Promise<{ s: Solicitud; plantilla: CampoPlantilla[]; mapeo: Mapeo }> {
  const s = await leerSolicitud(directory, caso);
  const { campos } = await leerPlantilla(directory, caso);
  const pedidos = etiquetas?.length ? etiquetas.map((e) => campos.find((c) => c.etiqueta === e) ?? { etiqueta: e, obligatorio: false }) : campos;
  return { s, plantilla: campos, mapeo: mapear(caso, pedidos, await indiceDelCaso(directory, s)) };
}

export interface MapeoRecibido {
  llenos?: { etiqueta: string; valor?: string }[];
}

/** CA2: si el modelo altera un valor del mapeo, se rechaza. El formulario solo usa valores recalculados. */
export function verificarMapeoRecibido(recibido: MapeoRecibido | string, real: Mapeo): string | null {
  if (typeof recibido === "string") return null; // mapeo_id: se usa el recálculo
  for (const c of recibido.llenos ?? []) {
    if (c.valor === undefined) continue;
    const r = valorParaFormulario(real, c.etiqueta);
    if (r.valor !== c.valor) return `El mapeo recibido no coincide con el maestro en "${c.etiqueta}" (recibido "${c.valor}"). No se generó el formulario: vuelve a llamar proveedor_mapear_campos y pasa su resultado sin modificar.`;
  }
  return null;
}

export interface Formulario {
  ruta: string;
  formato: string;
  soportado: boolean;
  campos_escritos: number;
  campos_vacios: string[];
}

export async function generarFormulario(directory: string, caso: string, fecha: string): Promise<{ f: Formulario; mapeo: Mapeo; s: Solicitud }> {
  const { s, plantilla, mapeo } = await mapearCaso(directory, caso);
  const filas: FilaFormulario[] = plantilla.map((c) => ({ ...c, ...valorParaFormulario(mapeo, c.etiqueta) }));
  const vacios = filas.filter((f) => !f.valor).map((f) => f.etiqueta);
  const escritos = filas.length - vacios.length;
  let ruta: string;
  if (s.formato === "xlsx") {
    if (filas.some((f) => !f.celda_valor)) throw new ErrorInsumo(`El caso "${caso}" pide xlsx pero no tiene plantilla-celdas.json con celdas.`);
    ruta = rutaOut(directory, caso, "formulario.xlsx");
    await escribirExcel(ruta, filas, rutaPlantillaXlsx(directory, caso, s.adjuntos));
  } else if (s.formato === "pdf") {
    ruta = rutaOut(directory, caso, "formulario.pdf");
    await escribirPdf(ruta, s, filas, fecha);
  } else {
    ruta = rutaOut(directory, caso, "valores-portal.md");
    await escribirValoresPortal(ruta, s, filas);
  }
  const soportado = s.formato === "xlsx" || s.formato === "pdf";
  return { f: { ruta: relativa(directory, ruta), formato: soportado ? s.formato : `${s.formato} (no soportado)`, soportado, campos_escritos: escritos, campos_vacios: vacios }, mapeo, s };
}

export interface Paquete {
  ruta: string;
  listo_para_firma: boolean;
  bloqueos: string[];
  checklist: {
    ruta: string;
    soportes: EstadoSoporte[];
    campos: { llenos: number; faltantes: string[]; requiere_confirmacion: { etiqueta: string; nota: string }[] };
  };
  archivos: string[];
  borrador_correo: string;
}

export async function armarPaquete(directory: string, caso: string, fecha: string): Promise<Paquete> {
  const s = await leerSolicitud(directory, caso);
  const dir = rutaOut(directory, caso, "paquete");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const bloqueos: string[] = [];
  const archivos: string[] = [];

  // 1. Formulario (si falla, el paquete continúa con soportes y checklist: HU-5)
  let mapeo: Mapeo | null = null;
  let formulario: string | null = null;
  try {
    const g = await generarFormulario(directory, caso, fecha);
    mapeo = g.mapeo;
    const nombre = g.f.ruta.split("/").pop()!;
    await copyFile(join(directory, g.f.ruta), join(dir, nombre));
    formulario = `${relativa(directory, dir)}/${nombre}`;
    archivos.push(nombre);
  } catch (e) {
    bloqueos.push(`Formulario no generado: ${(e as Error).message}`);
  }

  // 2. Soportes
  let soportes: EstadoSoporte[] = [];
  try {
    soportes = evaluarSoportes(await leerSoportesExigidos(directory, caso), await leerIndiceSoportes(directory), fecha, rutaSoportes(directory));
  } catch (e) {
    bloqueos.push(`Soportes no evaluados: ${(e as Error).message}`);
  }
  for (const sop of soportes) {
    if (sop.estado === "ausente") bloqueos.push(`Soporte ausente: ${sop.exigido}.`);
    if (sop.estado === "vencido") bloqueos.push(`Soporte vencido: ${sop.exigido} (${sop.motivo})`);
    if (sop.archivo && sop.estado !== "ausente") {
      const nombre = sop.estado === "vencido" ? `VENCIDO_${sop.archivo}` : sop.archivo;
      await copyFile(join(rutaSoportes(directory), sop.archivo), join(dir, nombre));
      archivos.push(nombre);
    }
  }

  // 3. Checklist y borrador de correo (RN2: sin datos bancarios)
  const listo = bloqueos.length === 0;
  await escribirTexto(join(dir, "checklist.md"), textoChecklist(s, caso, listo, bloqueos, soportes, mapeo, formulario, fecha));
  const adjuntos = archivos.filter((a) => !a.startsWith("VENCIDO_"));
  const pendientes = [
    ...(mapeo ? [...mapeo.faltantes.map((f) => f.etiqueta), ...mapeo.requiere_confirmacion.map((f) => f.etiqueta)] : []),
    ...soportes.filter((x) => x.estado !== "presente").map((x) => `soporte ${x.exigido} (${x.estado}; se enviará por separado)`),
  ];
  const maestro = await leerMaestro(directory);
  const razon = valorEnRuta(maestro, "razon_social");
  const bancarios = reglas.claves_bancarias.map((k) => valorEnRuta(maestro, k)).filter((v): v is string => v !== null && v !== razon);
  await escribirTexto(join(dir, "borrador-correo.md"), sinDatosBancarios(textoBorradorCorreo(s, adjuntos, pendientes), bancarios));
  archivos.push("checklist.md", "borrador-correo.md");

  return {
    ruta: relativa(directory, dir),
    listo_para_firma: listo,
    bloqueos,
    checklist: {
      ruta: `${relativa(directory, dir)}/checklist.md`,
      soportes,
      campos: {
        llenos: mapeo?.llenos.length ?? 0,
        faltantes: mapeo?.faltantes.map((f) => f.etiqueta) ?? [],
        requiere_confirmacion: mapeo?.requiere_confirmacion.map((f) => ({ etiqueta: f.etiqueta, nota: f.nota })) ?? [],
      },
    },
    archivos,
    borrador_correo: `${relativa(directory, dir)}/borrador-correo.md`,
  };
}
