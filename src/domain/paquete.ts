/**
 * Armado del paquete para firma del representante legal:
 *   00_carta_remisoria.pdf     → carta al cliente con índice de documentos y bloque de firma
 *   01_formulario.(xlsx|pdf)   → formulario diligenciado
 *   02..NN_<soporte>.pdf       → soportes vigentes
 *   resumen_validacion.json    → hallazgos y trazabilidad de cada campo (fuente del dato)
 *   manifest.json              → hashes SHA-256 de cada archivo + confirmación humana
 *   paquete_<caso>_<ESTADO>.zip
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Analisis } from "./analisis";
import type { Confirmacion } from "./estado";
import type { Fixtures } from "./fixtures";
import { fechaFija, llenarFormulario } from "./formularios";
import { formatearFecha } from "./reglas";

export interface ResultadoPaquete {
  estado: "LISTO_PARA_FIRMA" | "BORRADOR";
  directorio: string;
  zip: string;
  archivos: { nombre: string; sha256: string; bytes: number }[];
  pendientes: string[];
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function envolver(texto: string, font: PDFFont, size: number, ancho: number): string[] {
  const palabras = texto.split(/\s+/);
  const lineas: string[] = [];
  let actual = "";
  for (const p of palabras) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (font.widthOfTextAtSize(prueba, size) > ancho && actual) {
      lineas.push(actual);
      actual = p;
    } else actual = prueba;
  }
  if (actual) lineas.push(actual);
  return lineas;
}

async function cartaRemisoria(a: Analisis, fx: Fixtures, estado: ResultadoPaquete["estado"], indice: string[], conf: Confirmacion): Promise<Uint8Array> {
  const repo = await fx.repositorio();
  const pdf = await PDFDocument.create();
  const f = fechaFija(a.fecha_referencia);
  pdf.setCreationDate(f);
  pdf.setModificationDate(f);
  pdf.setTitle(`Carta remisoria ${a.caso_id}`);
  pdf.setProducer("Agente de vinculación de proveedores");
  pdf.setCreator("Agente de vinculación de proveedores");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([595, 842]);
  let y = 790;
  const X = 56;
  const ANCHO = 483;
  const linea = (t: string, o: { b?: boolean; s?: number; gap?: number } = {}) => {
    const size = o.s ?? 10;
    for (const l of envolver(t, o.b ? bold : font, size, ANCHO)) {
      if (y < 70) {
        page = pdf.addPage([595, 842]);
        y = 790;
      }
      page.drawText(l, { x: X, y, size, font: o.b ? bold : font });
      y -= size + 4;
    }
    y -= o.gap ?? 2;
  };

  linea(repo.empresa.razon_social, { b: true, s: 13 });
  linea(`NIT ${repo.empresa.nit}-${repo.empresa.nit_dv} · ${repo.empresa.direccion} · ${repo.empresa.ciudad}`, { s: 8, gap: 14 });
  linea(`${repo.empresa.ciudad}, ${formatearFecha(a.fecha_referencia, "DD/MM/YYYY")}`, { gap: 10 });
  linea("Señores", {});
  linea(a.solicitud.cliente.razon_social, { b: true });
  linea(`${a.solicitud.cliente.pais}${a.solicitud.cliente.contacto ? " · " + a.solicitud.cliente.contacto : ""}`, { gap: 12 });
  linea(`Referencia: ${a.solicitud.proceso}${a.solicitud.radicado ? ` (radicado ${a.solicitud.radicado})` : ""}`, { b: true, gap: 10 });
  linea(
    `Por medio de la presente, ${repo.empresa.razon_social} remite la documentación solicitada para el proceso de la referencia. Los datos consignados provienen del repositorio corporativo (versión ${repo.version}) y los soportes adjuntos se encuentran vigentes a la fecha de esta comunicación según los criterios de su solicitud.`,
    { gap: 10 },
  );
  linea("Documentos adjuntos:", { b: true });
  indice.forEach((d, i) => linea(`${i + 1}. ${d}`));
  y -= 8;
  if (estado === "BORRADOR") {
    linea("Pendientes antes de firma:", { b: true });
    for (const h of a.hallazgos.filter((h) => h.severidad === "bloqueante")) linea(`• ${h.mensaje}`, { s: 9 });
    y -= 6;
  }
  linea("Atentamente,", { gap: 46 });
  page.drawLine({ start: { x: X, y: y + 14 }, end: { x: X + 230, y: y + 14 }, thickness: 0.8 });
  linea(repo.representante_legal.nombre, { b: true });
  linea(`${repo.representante_legal.tipo_documento} ${repo.representante_legal.numero_documento}`);
  linea(repo.representante_legal.cargo, { gap: 18 });
  linea(`Control: estado ${estado} · confirmación ${conf.id} aprobada por ${conf.decidida_por ?? "-"} · huella ${a.huella}`, { s: 7 });

  if (estado === "BORRADOR") {
    for (const p of pdf.getPages()) {
      p.drawText("BORRADOR - NO FIRMAR", { x: 90, y: 300, size: 46, font: bold, color: rgb(0.85, 0.1, 0.1), opacity: 0.18, rotate: degrees(35) });
    }
  }
  return pdf.save({ useObjectStreams: false });
}

export async function armarPaquete(a: Analisis, fx: Fixtures, dirSalida: string, conf: Confirmacion): Promise<ResultadoPaquete> {
  const estado: ResultadoPaquete["estado"] = conf.modo === "final" && a.resumen.puede_paquete_final ? "LISTO_PARA_FIRMA" : "BORRADOR";
  const dir = join(dirSalida, a.caso_id, "paquete");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  // 1. Formulario
  const ext = a.plantilla.tipo === "excel" ? ".xlsx" : ".pdf";
  const nombreForm = `01_formulario_${a.caso_id}${ext}`;
  const llenado = await llenarFormulario(a, await fx.rutaFormulario(a.caso_id), join(dir, nombreForm));

  // 2. Soportes vigentes
  const indiceDocs: string[] = [`Formulario diligenciado (${nombreForm})`];
  const soportesIncluidos: string[] = [];
  let n = 2;
  for (const s of a.soportes.filter((s) => s.incluir_en_paquete && s.documento)) {
    const nombre = `${String(n).padStart(2, "0")}_${s.tipo}${extname(s.documento!.archivo)}`;
    await copyFile(fx.rutaSoporte(s.documento!.archivo), join(dir, nombre));
    indiceDocs.push(`${s.documento!.nombre} - expedido ${formatearFecha(s.documento!.fecha_emision, "DD/MM/YYYY")}, vigente hasta ${formatearFecha(s.vence_el!, "DD/MM/YYYY")} (${nombre})`);
    soportesIncluidos.push(nombre);
    n++;
  }

  // 3. Carta remisoria
  const carta = await cartaRemisoria(a, fx, estado, indiceDocs, conf);
  await writeFile(join(dir, "00_carta_remisoria.pdf"), carta);

  // 4. Resumen de validación (trazabilidad campo → fuente)
  const resumen = {
    caso_id: a.caso_id,
    estado,
    fecha_referencia: a.fecha_referencia,
    huella_analisis: a.huella,
    resumen: a.resumen,
    campos: a.campos.map((c) => ({ id: c.id, etiqueta: c.etiqueta, destino: c.destino, valor: c.valor, fuente: c.fuente, ruta_dato: c.ruta_dato, clave: c.mapeo.clave, metodo_mapeo: c.mapeo.metodo, nota: c.nota, estado: c.estado })),
    soportes: a.soportes,
    hallazgos: a.hallazgos,
    campos_vacios: llenado.campos_vacios,
  };
  await writeFile(join(dir, "resumen_validacion.json"), JSON.stringify(resumen, null, 2));

  // 5. Manifest con hashes
  const nombres = ["00_carta_remisoria.pdf", nombreForm, ...soportesIncluidos, "resumen_validacion.json"];
  const archivos: ResultadoPaquete["archivos"] = [];
  for (const nom of nombres) {
    const b = await readFile(join(dir, nom));
    archivos.push({ nombre: nom, sha256: sha256(b), bytes: b.length });
  }
  const manifest = {
    caso_id: a.caso_id,
    cliente: a.solicitud.cliente.razon_social,
    estado,
    generado_para_fecha: a.fecha_referencia,
    confirmacion_humana: { id: conf.id, modo: conf.modo, aprobada_por: conf.decidida_por, comentario: conf.comentario ?? null },
    firma_requerida: (await fx.repositorio()).representante_legal.nombre,
    archivos,
  };
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // 6. ZIP determinista (fechas fijas, orden fijo)
  const zip = new JSZip();
  const fz = fechaFija(a.fecha_referencia);
  for (const nom of [...nombres, "manifest.json"]) zip.file(nom, await readFile(join(dir, nom)), { date: fz });
  const zipNombre = `paquete_${a.caso_id}_${estado}.zip`;
  const zipRuta = join(dirSalida, a.caso_id, zipNombre);
  await writeFile(zipRuta, await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } }));

  return {
    estado,
    directorio: dir,
    zip: zipRuta,
    archivos,
    pendientes: a.hallazgos.filter((h) => h.severidad === "bloqueante").map((h) => h.mensaje),
  };
}

export { basename };
