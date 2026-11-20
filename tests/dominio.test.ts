import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { calcularDvNit, diasEntre, extraerVigenciaDias, formatearNumero, normalizar } from "../src/domain/reglas";
import { construirIndice, mapearEtiqueta, mapearSoporte } from "../src/domain/glosario";
import { Fixtures } from "../src/domain/fixtures";

const fx = new Fixtures(join(import.meta.dir, "..", "fixtures", "reto-01"));

describe("reglas", () => {
  test("DV de NIT (DIAN módulo 11)", () => {
    expect(calcularDvNit("900123456")).toBe("8");
    expect(calcularDvNit("860034313")).toBe("7"); // NIT público conocido (Davivienda)
    expect(calcularDvNit("800197268")).toBe("4"); // DIAN
  });
  test("normalización de etiquetas", () => {
    expect(normalizar("  Razón  Social del PROVEEDOR *")).toBe("razon social del proveedor");
    expect(normalizar("Contact e-mail:")).toBe("contact e mail");
  });
  test("extrae vigencias del texto libre del cliente", () => {
    expect(extraerVigenciaDias("Certificado ... con expedición no mayor a 30 días")).toBe(30);
    expect(extraerVigenciaDias("Referencia bancaria con expedición no superior a 15 días")).toBe(15);
    expect(extraerVigenciaDias("Certificate of incorporation no older than 60 days")).toBe(60);
    expect(extraerVigenciaDias("RUT actualizado")).toBeUndefined();
  });
  test("días entre fechas y formato numérico", () => {
    expect(diasEntre("2026-10-30", "2026-11-19")).toBe(20);
    expect(formatearNumero(4610764.27, 2, "en-US")).toBe("4,610,764.27");
    expect(formatearNumero(11300000000, 0, "es-CO")).toBe("11.300.000.000");
    expect(formatearNumero(-1234.5, 2, "es-CO")).toBe("-1.234,50");
  });
});

describe("glosario", async () => {
  const g = await fx.glosario();
  const idx = construirIndice(g.campos);
  test.each([
    ["NIT (sin dígito de verificación)", "nit"],
    ["RTN / Identificación tributaria", "rtn"],
    ["Tax ID / RUC", "nit"],
    ["Cédula/Pasaporte Rep. Legal", "rep_legal_documento"],
    ["Total assets (USD)", "activos_totales"],
    ["DV", "nit_dv"],
  ])("'%s' → clave", (etiqueta, esperado) => {
    const r = mapearEtiqueta(etiqueta, idx);
    expect(r.clave === esperado || (esperado === "rtn" && r.clave === "nit")).toBe(true);
    expect(r.metodo).toBe("exacto");
  });
  test("mapeo aproximado por tokens", () => {
    const r = mapearEtiqueta("Correo electrónico de notificaciones", idx);
    expect(r.clave).toBe("email_notificaciones");
    expect(r.metodo).toBe("aproximado");
  });
  test("no inventa: etiqueta sin equivalente queda sin mapeo", () => {
    const r = mapearEtiqueta("Registro de proveedor del Estado (ONCAE)", idx);
    expect(r.clave).toBeNull();
    expect(r.metodo).toBe("sin_mapeo");
  });
  test("soportes por descripción libre", () => {
    expect(mapearSoporte("Bank reference letter", g).tipo).toBe("certificacion_bancaria");
    expect(mapearSoporte("Certificación de aportes parafiscales y seguridad social no mayor a 30 días", g).tipo).toBe("certificado_parafiscales");
    expect(mapearSoporte("Póliza de cumplimiento", g).tipo).toBeNull();
  });
});
