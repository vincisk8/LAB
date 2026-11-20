/** Escritura de salidas: formulario.xlsx, formulario.pdf, valores-portal.md, checklist.md, borrador-correo.md, ENVIO-SIMULADO.md. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { CampoPlantilla, Solicitud } from "./insumos";
import type { Mapeo } from "./mapeo";
import type { EstadoSoporte } from "./soportes";

export interface FilaFormulario extends CampoPlantilla {
  valor: string | null;
  estado: "lleno" | "requiere_confirmacion" | "faltante";
}

async function asegurarDir(ruta: string): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true });
}

// ───────────────────────────── Excel (P0) ─────────────────────────────

const RELLENO: Record<FilaFormulario["estado"], string> = { lleno: "FFE2F0D9", requiere_confirmacion: "FFFFF2CC", faltante: "FFF8D7DA" };

export async function escribirExcel(ruta: string, filas: FilaFormulario[], plantillaBase: string | null): Promise<void> {
  const wb = new ExcelJS.Workbook();
  if (plantillaBase) await wb.xlsx.load((await readFile(plantillaBase)) as unknown as ArrayBuffer);
  wb.creator = "Agente de registro como proveedor";
  for (const f of filas) {
    const hoja = f.hoja ?? "Formulario";
    const ws = wb.getWorksheet(hoja) ?? wb.addWorksheet(hoja);
    const etiqueta = ws.getCell(f.celda_etiqueta ?? "A1");
    const valor = ws.getCell(f.celda_valor ?? "B1");
    etiqueta.value = f.etiqueta;
    etiqueta.font = { bold: true };
    valor.value = f.valor ?? "";
    valor.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RELLENO[f.estado] } };
    if (f.estado !== "lleno") valor.note = f.estado === "faltante" ? "FALTANTE: completar manualmente" : "REQUIERE CONFIRMACIÓN";
    ws.getColumn(etiqueta.col).width = Math.max(ws.getColumn(etiqueta.col).width ?? 10, f.etiqueta.length + 4);
    ws.getColumn(valor.col).width = Math.max(ws.getColumn(valor.col).width ?? 10, (f.valor ?? "").length + 4, 24);
  }
  await asegurarDir(ruta);
  await writeFile(ruta, Buffer.from(await wb.xlsx.writeBuffer()));
}

// ───────────────────────────── PDF (P1) ─────────────────────────────

/** Helvetica estándar usa WinAnsi: se reemplazan caracteres fuera de Latin-1. */
const winAnsi = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

function envolver(texto: string, font: PDFFont, size: number, ancho: number): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of winAnsi(texto).split(/\s+/)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (actual && font.widthOfTextAtSize(prueba, size) > ancho) {
      lineas.push(actual);
      actual = palabra;
    } else actual = prueba;
  }
  return actual ? [...lineas, actual] : lineas.length ? lineas : [""];
}

export async function escribirPdf(ruta: string, s: Solicitud, filas: FilaFormulario[], fecha: string): Promise<void> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Registro de proveedor - ${s.cliente}`);
  pdf.setProducer("Agente de registro como proveedor");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([595, 842]);
  let y = 790;
  const nueva = () => {
    page = pdf.addPage([595, 842]);
    y = 790;
  };
  const texto = (t: string, x: number, f: PDFFont, size: number, color = rgb(0, 0, 0)) => page.drawText(winAnsi(t), { x, y, size, font: f, color });

  texto("FORMULARIO DE REGISTRO COMO PROVEEDOR", 50, bold, 14);
  y -= 20;
  for (const l of envolver(`Cliente: ${s.cliente} (${s.pais_nombre}) · Ref: ${s.asunto}`, font, 9, 495)) {
    texto(l, 50, font, 9);
    y -= 12;
  }
  texto(`Fecha de diligenciamiento: ${fecha}`, 50, font, 9);
  y -= 26;

  for (const f of filas) {
    const etiq = envolver(f.etiqueta + (f.obligatorio ? " *" : ""), bold, 10, 190);
    const marca = f.estado === "faltante" ? "(faltante)" : f.estado === "requiere_confirmacion" ? "  [por confirmar]" : "";
    const val = envolver((f.valor ?? "") + marca, font, 10, 290);
    const alto = Math.max(etiq.length, val.length) * 13 + 8;
    if (y - alto < 80) nueva();
    page.drawLine({ start: { x: 50, y: y + 12 }, end: { x: 545, y: y + 12 }, thickness: 0.4, color: rgb(0.8, 0.8, 0.8) });
    etiq.forEach((l, i) => page.drawText(l, { x: 50, y: y - i * 13, size: 10, font: bold }));
    val.forEach((l, i) => page.drawText(l, { x: 255, y: y - i * 13, size: 10, font, color: f.estado === "lleno" ? rgb(0, 0, 0) : rgb(0.7, 0.3, 0) }));
    y -= alto;
  }
  if (y < 140) nueva();
  y -= 40;
  page.drawLine({ start: { x: 50, y }, end: { x: 300, y }, thickness: 0.8 });
  y -= 14;
  texto("Firma del representante legal", 50, font, 9);
  await asegurarDir(ruta);
  await writeFile(ruta, await pdf.save());
}

// ───────────────────────────── Portal (P2) ─────────────────────────────

const celdaMd = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export async function escribirValoresPortal(ruta: string, s: Solicitud, filas: FilaFormulario[]): Promise<void> {
  const tabla = filas.map((f) => `| ${celdaMd(f.etiqueta)} | ${f.valor ? "`" + celdaMd(f.valor) + "`" : "—"} | ${f.estado} |`).join("\n");
  const md = `# Valores para el portal de ${s.cliente}

> **Formato no soportado:** portal web. El agente no inicia sesión ni carga datos en portales.
> La analista ingresa las credenciales, copia estos valores y hace clic en "Enviar".

| Campo del portal | Valor para copiar | Estado |
|---|---|---|
${tabla}

Los campos \`requiere_confirmacion\` y \`faltante\` deben revisarse antes de enviar el formulario del portal.
`;
  await asegurarDir(ruta);
  await writeFile(ruta, md, "utf8");
}

// ───────────────────────────── Paquete ─────────────────────────────

export function textoChecklist(s: Solicitud, caso: string, listo: boolean, bloqueos: string[], soportes: EstadoSoporte[], m: Mapeo | null, formulario: string | null, fecha: string): string {
  const icono = { presente: "✅", vencido: "⛔", ausente: "❌" };
  const filasSop = soportes.map((x) => `| ${icono[x.estado]} ${x.estado} | ${x.exigido} | ${x.archivo ?? "—"} | ${x.vigencia_hasta ?? "sin vencimiento"} | ${x.motivo} |`).join("\n");
  const faltantes = m?.faltantes.map((f) => `- [ ] **${f.etiqueta}**${f.obligatorio ? " (obligatorio)" : ""}: ${f.motivo}`).join("\n") || "- Ninguno";
  const confirmar = m?.requiere_confirmacion.map((f) => `- [ ] **${f.etiqueta}**: ${f.nota}`).join("\n") || "- Ninguno";
  return `# Checklist · ${caso}

- **Cliente:** ${s.cliente} (${s.pais_nombre})
- **Solicitud:** ${s.asunto} (${s.fecha})
- **Fecha de ejecución:** ${fecha}
- **Formulario:** ${formulario ?? "NO GENERADO"}
- **Estado:** ${listo ? "✅ LISTO PARA FIRMA" : "⛔ NO LISTO PARA FIRMA"}
${bloqueos.length ? "\n## Bloqueos\n" + bloqueos.map((b) => `- ${b}`).join("\n") + "\n" : ""}
## Soportes

| Estado | Exigido | Archivo | Vigencia hasta | Detalle |
|---|---|---|---|---|
${filasSop || "| — | Sin soportes exigidos | | | |"}

## Campos faltantes (no bloquean la firma, deben completarse)
${faltantes}

## Campos que requieren confirmación
${confirmar}

## Antes de firmar
- [ ] Revisar el formulario y los campos marcados.
- [ ] Firma del representante legal.
- [ ] Confirmar el envío al cliente (acción humana).
`;
}

export function textoBorradorCorreo(s: Solicitud, adjuntos: string[], pendientes: string[]): string {
  return `**Para:** ${s.de}
**Asunto:** Re: ${s.asunto}

Buen día,

En atención a su solicitud ${s.id}, remitimos el formulario de registro como proveedor diligenciado y firmado por nuestro representante legal, junto con los soportes requeridos:

${adjuntos.map((a) => `- ${a}`).join("\n")}
${pendientes.length ? `\nQuedamos atentos a confirmar los siguientes puntos: ${pendientes.join("; ")}.\n` : ""}
Cordialmente,

Área Administrativa
Periferia IT Group S.A.S.

<!-- Borrador generado por el agente. Revisar antes de enviar. Por política (RN2) no incluye datos bancarios. -->
`;
}

/** RN2: garantiza que ningún dato bancario del maestro aparezca en el borrador. */
export function sinDatosBancarios(texto: string, valoresBancarios: string[]): string {
  return valoresBancarios.filter((v) => v.length >= 4).reduce((t, v) => t.split(v).join("[dato bancario omitido]"), texto);
}

export async function escribirTexto(ruta: string, texto: string): Promise<void> {
  await asegurarDir(ruta);
  await writeFile(ruta, texto, "utf8");
}
