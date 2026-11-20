import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AlmacenSesiones } from "../src/domain/estado";
import { Fixtures } from "../src/domain/fixtures";
import { ejecutarHerramienta, type ContextoHerramientas } from "../src/tools/proveedor";

function ctx(fecha = "2026-11-19"): ContextoHerramientas {
  return {
    fixtures: new Fixtures(join(import.meta.dir, "..", "fixtures", "reto-01")),
    sesion: new AlmacenSesiones(() => `${fecha}T12:00:00Z`).obtener("test"),
    fechaReferencia: fecha,
    dirSalida: mkdtempSync(join(tmpdir(), "reto1-")),
  };
}

describe("herramientas", () => {
  test("validación zod de entradas", async () => {
    const r = await ejecutarHerramienta("leer_solicitud", { caso_id: 42 }, ctx());
    expect(r.ok).toBe(false);
    expect(r.error?.codigo).toBe("ENTRADA_INVALIDA");
    expect((await ejecutarHerramienta("no_existe", {}, ctx())).error?.codigo).toBe("HERRAMIENTA_DESCONOCIDA");
  });

  test("human-in-the-loop: el paquete exige aprobación hecha por el humano", async () => {
    const c = ctx();
    const conf = await ejecutarHerramienta("solicitar_confirmacion_humana", { caso_id: "co-industrias-delta", modo: "final", resumen: "Paquete final de prueba" }, c);
    expect(conf.confirmacion_requerida).toBeDefined();
    const id = conf.confirmacion_requerida!.id;
    const sin = await ejecutarHerramienta("armar_paquete", { caso_id: "co-industrias-delta", confirmacion_id: id }, c);
    expect(sin.error?.codigo).toBe("CONFIRMACION_NO_APROBADA");
    c.sesion.decidir(id, "aprobar", "tester");
    const con = await ejecutarHerramienta("armar_paquete", { caso_id: "co-industrias-delta", confirmacion_id: id }, c);
    expect(con.ok).toBe(true);
    expect((con.datos as { estado: string }).estado).toBe("LISTO_PARA_FIRMA");
  });

  test("cambiar datos después de solicitar confirmación invalida la aprobación", async () => {
    const c = ctx();
    const conf = await ejecutarHerramienta("solicitar_confirmacion_humana", { caso_id: "hn-agroexport-sula", modo: "borrador", resumen: "Borrador de prueba" }, c);
    await ejecutarHerramienta("registrar_valor_manual", { caso_id: "hn-agroexport-sula", campo_id: "h09", valor: "En trámite" }, c);
    expect(() => c.sesion.decidir(conf.confirmacion_requerida!.id, "aprobar", "tester")).toThrow();
  });

  test("no permite paquete final con bloqueantes", async () => {
    const r = await ejecutarHerramienta("solicitar_confirmacion_humana", { caso_id: "pa-logistica-istmo", modo: "final", resumen: "Intento final" }, ctx());
    expect(r.error?.codigo).toBe("FINAL_NO_PERMITIDO");
  });

  test("la vigencia depende de la fecha de referencia", async () => {
    const antes = await ejecutarHerramienta("verificar_soportes", { caso_id: "pa-logistica-istmo" }, ctx("2026-11-10"));
    const bancaria = (antes.datos as { soportes: { tipo: string; estado: string }[] }).soportes.find((s) => s.tipo === "certificacion_bancaria");
    expect(bancaria?.estado).toBe("vigente");
    const despues = await ejecutarHerramienta("verificar_soportes", { caso_id: "pa-logistica-istmo" }, ctx("2026-11-19"));
    expect((despues.datos as { soportes: { tipo: string; estado: string }[] }).soportes.find((s) => s.tipo === "certificacion_bancaria")?.estado).toBe("vencido");
  });

  test("registrar_valor_manual respeta la longitud máxima del formulario", async () => {
    const r = await ejecutarHerramienta("registrar_valor_manual", { caso_id: "pa-logistica-istmo", campo_id: "p04", valor: "X".repeat(41) }, ctx());
    expect(r.error?.codigo).toBe("LONGITUD_EXCEDIDA");
  });
});
