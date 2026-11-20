/**
 * Bonus (PRD §9.4): genera modulo/ a partir de las MISMAS fuentes que usa la aplicación,
 * para que nunca haya copias divergentes:
 *   agent/prompt.md                      → modulo/agent.md          (frontmatter + system prompt)
 *   src/knowledge/registro-proveedor.md  → modulo/skill/registro-proveedor/SKILL.md
 *   src/tools/proveedor.ts               → modulo/tools/proveedor.ts (re-export, sin servidor)
 * `bun test` verifica que modulo/ esté sincronizado.
 *
 * Uso: bun scripts/construir-modulo.ts
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function contenidoModulo(raiz = RAIZ): Promise<Record<string, string>> {
  const prompt = await readFile(join(raiz, "agent", "prompt.md"), "utf8");
  const conocimiento = await readFile(join(raiz, "src", "knowledge", "registro-proveedor.md"), "utf8");
  return {
    "agent.md": `---
description: Agente que llena formularios de registro como proveedor desde el repositorio maestro y arma el paquete para firma; nunca firma ni envía sin confirmación humana.
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt}`,
    "skill/registro-proveedor/SKILL.md": `---
name: registro-proveedor
description: Conocimiento del proceso de registro como proveedor de Periferia (identificador tributario por país, soportes y vigencias, datos bancarios, confirmación humana). Usar al procesar solicitudes de registro de clientes.
---

${conocimiento}`,
    "tools/proveedor.ts": `/**
 * Herramientas del agente, importables sin el servidor HTTP.
 * Re-exporta la implementación única de src/tools/proveedor.ts (no es una copia).
 * Cada export es { description, args (zod), execute(args, ctx: { directory, sessionId }) → string JSON }.
 * Para RN4, la plataforma anfitriona debe llamar registrarMensajeUsuario (./confirmaciones) con cada
 * mensaje del usuario, antes de pasarlo al modelo.
 */
export * from "../../src/tools/proveedor";
`,
    "tools/confirmaciones.ts": `/** Gancho para la plataforma anfitriona: registrar cada mensaje del usuario (confirmación explícita, RN4). */
export { registrarMensajeUsuario, esConfirmacion } from "../../src/tools/confirmaciones";
`,
  };
}

if (import.meta.main) {
  for (const [ruta, contenido] of Object.entries(await contenidoModulo())) {
    const destino = join(RAIZ, "modulo", ruta);
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, contenido, "utf8");
    console.log(`modulo/${ruta}`);
  }
}
