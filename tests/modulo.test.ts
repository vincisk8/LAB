/** Bonus §9.4: modulo/ debe ser idéntico a lo que genera construir-modulo.ts desde las fuentes de la app. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contenidoModulo } from "../scripts/construir-modulo";
import * as deModulo from "../modulo/tools/proveedor";
import * as deApp from "../src/tools/proveedor";
import { RAIZ } from "./utiles";

test("modulo/ está sincronizado con agent/prompt.md, src/knowledge y src/tools (sin copias divergentes)", async () => {
  for (const [ruta, esperado] of Object.entries(await contenidoModulo(RAIZ))) {
    expect(readFileSync(join(RAIZ, "modulo", ruta), "utf8")).toBe(esperado);
  }
  expect(Object.keys(deModulo).sort()).toEqual(Object.keys(deApp).sort());
  for (const k of Object.keys(deApp) as (keyof typeof deApp)[]) expect(deModulo[k]).toBe(deApp[k]);
});
