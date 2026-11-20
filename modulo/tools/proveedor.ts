/**
 * Herramientas del agente, importables sin el servidor HTTP.
 * Re-exporta la implementación única de src/tools/proveedor.ts (no es una copia).
 * Cada export es { description, args (zod), execute(args, ctx: { directory, sessionId }) → string JSON }.
 * Para RN4, la plataforma anfitriona debe llamar registrarMensajeUsuario (./confirmaciones) con cada
 * mensaje del usuario, antes de pasarlo al modelo.
 */
export * from "../../src/tools/proveedor";
