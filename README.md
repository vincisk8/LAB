# Agente de Vinculación de Proveedores · Reto 1 (Periferia IT Group)

Este agente conversacional, escrito en TypeScript sobre Bun, procesa la solicitud de un cliente de punta a punta:

1. Lee la solicitud del cliente.
2. La cruza con el repositorio maestro de Periferia y valida datos y vigencias de soportes.
3. Diligencia el formulario del cliente (Excel o PDF).
4. Arma el paquete para que lo firme el representante legal.

El paquete solo se genera **después de una aprobación humana, y esa aprobación la valida el servidor**.

📄 La documentación técnica completa está en [`SOLUCION.md`](./SOLUCION.md). Incluye la arquitectura, el ciclo del agente, las decisiones de diseño, los costos y las consideraciones de producción.

## Inicio rápido

```bash
bun install
bun demo.ts --check     # verificación determinista sin LLM (4 casos)
bun test                # pruebas unitarias
bun start               # chat en http://localhost:3000
```

- **Sin `ANTHROPIC_API_KEY`**, el chat arranca en **modo simulado**: no usa LLM, no cuesta nada y usa las mismas herramientas.
- **Con la llave**, el chat usa Claude (por defecto `claude-sonnet-5-5`). Ver `.env.example`.

## Estructura

```
agent/prompt.md          System prompt
src/tools/proveedor.ts   Herramientas tipadas con zod (una sola fuente → JSON Schema para el LLM)
src/agent/               Loop del agente (Claude) + agente simulado + contrato de eventos SSE
src/domain/              Lógica determinista: glosario, reglas, vigencias, formularios, paquete, estado
src/server.ts            Backend HTTP + SSE + confirmaciones + descargas
public/                  Frontend de chat (tool calls visibles y confirmaciones resaltadas)
demo.ts                  Script de verificación sin LLM
fixtures/reto-01/        Casos, repositorio maestro, soportes, glosario (reconstruidos; ver SOLUCION.md §1)
scripts/                 generar-fixtures.ts · costos.ts
```

## Despliegue

Hay dos opciones:

- **Render:** usar `render.yaml` (Blueprint).
- **Fly.io:** usar `fly.toml`.

Ambas construyen el `Dockerfile`, que ejecuta `demo.ts` en el build. Los pasos están en `SOLUCION.md §10`.

**URL pública:** `https://<tu-servicio>.onrender.com` (completar tras desplegar).
