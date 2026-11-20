/** Contenido de ENVIO-SIMULADO.md (HU-4). No se envía nada real. */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { rutaOut, type Solicitud } from "./insumos";

export async function textoEnvio(directory: string, caso: string, s: Solicitud, archivos: string[], sesion: string): Promise<string> {
  const dir = rutaOut(directory, caso, "paquete");
  const checklist = existsSync(join(dir, "checklist.md")) ? await readFile(join(dir, "checklist.md"), "utf8") : "";
  const listo = checklist.includes("LISTO PARA FIRMA") && !checklist.includes("NO LISTO");
  const borrador = existsSync(join(dir, "borrador-correo.md")) ? await readFile(join(dir, "borrador-correo.md"), "utf8") : "";
  return `# ENVÍO SIMULADO · ${caso}

> Simulación: **no se envió ningún correo ni se cargó nada en portales.**

- **Fecha:** ${new Date().toISOString()}
- **Para:** ${s.de}
- **Asunto:** Re: ${s.asunto}
- **Confirmado por:** el usuario de la sesión \`${sesion}\` en su último mensaje (RN4)
- **Estado del paquete:** ${listo ? "listo para firma" : "⚠️ NO listo para firma (ver checklist): el usuario confirmó de todas formas"}

## Adjuntos
${archivos.filter((a) => !a.startsWith("VENCIDO_") && a !== "checklist.md" && a !== "borrador-correo.md").map((a) => `- ${a}`).join("\n")}

## Cuerpo
${borrador}
`;
}
