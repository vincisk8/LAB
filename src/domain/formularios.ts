/**
 * Llenado de formularios del cliente (Excel por celdas, PDF por campos AcroForm).
 * Fechas internas fijadas a la fecha de referencia → el mismo insumo produce el mismo archivo (hash estable).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import type { Analisis } from "./analisis";

export interface ResultadoLlenado {
  archivo: string;
  tipo: "excel" | "pdf";
  campos_llenados: { id: string; destino: string; valor: string }[];
  campos_vacios: { id: string; destino: string; etiqueta: string; motivo: string }[];
}

export function fechaFija(iso: string) {
  return new Date(`${iso}T12:00:00Z`);
}

export async function llenarFormulario(a: Analisis, plantillaRuta: string, salida: string): Promise<ResultadoLlenado> {
  await mkdir(dirname(salida), { recursive: true });
  const llenados: ResultadoLlenado["campos_llenados"] = [];
  const vacios: ResultadoLlenado["campos_vacios"] = [];
  const fecha = fechaFija(a.fecha_referencia);

  const aLlenar = a.campos.filter((c) => {
    const ok = c.valor !== null && c.estado === "ok";
    if (!ok) vacios.push({ id: c.id, destino: c.destino, etiqueta: c.etiqueta, motivo: c.valor === null ? "sin dato" : `estado ${c.estado}` });
    return ok;
  });

  if (a.plantilla.tipo === "excel") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await readFile(plantillaRuta)) as unknown as ArrayBuffer);
    const ws = (a.solicitud.formulario.hoja && wb.getWorksheet(a.solicitud.formulario.hoja)) || wb.worksheets[0];
    if (!ws) throw new Error("La plantilla Excel no tiene hojas");
    for (const c of aLlenar) {
      ws.getCell(c.destino).value = c.valor;
      llenados.push({ id: c.id, destino: c.destino, valor: c.valor! });
    }
    wb.created = fecha;
    wb.modified = fecha;
    wb.lastModifiedBy = "Agente de vinculación de proveedores";
    await writeFile(salida, Buffer.from(await wb.xlsx.writeBuffer()));
  } else {
    const pdf = await PDFDocument.load(await readFile(plantillaRuta));
    const form = pdf.getForm();
    for (const c of aLlenar) {
      const campo = form.getTextField(c.destino);
      campo.setText(c.valor!);
      llenados.push({ id: c.id, destino: c.destino, valor: c.valor! });
    }
    form.updateFieldAppearances();
    pdf.setModificationDate(fecha);
    pdf.setCreationDate(fecha);
    pdf.setProducer("Agente de vinculación de proveedores");
    await writeFile(salida, await pdf.save({ useObjectStreams: false }));
  }
  return { archivo: salida, tipo: a.plantilla.tipo, campos_llenados: llenados, campos_vacios: vacios };
}
