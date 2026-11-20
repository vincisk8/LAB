/**
 * Backend HTTP (Bun.serve): sirve el frontend de chat, expone el agente por SSE y aplica la
 * confirmación humana. Endpoints:
 *   GET  /api/config                 modo (anthropic|simulado), modelo, fecha de referencia
 *   POST /api/chat                   { sesion_id, mensaje } → text/event-stream de Evento
 *   POST /api/confirmaciones/:id     { sesion_id, decision: aprobar|rechazar, comentario? }
 *   POST /api/reiniciar              { sesion_id }
 *   GET  /api/descargas/:sesion/...  archivos generados (solo dentro de la carpeta de la sesión)
 *   GET  /api/salud
 */
import { existsSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { config, RAIZ } from "./config";
import { AgenteClaude } from "./agent/loop";
import { AgenteSimulado } from "./agent/simulado";
import type { Agente, Evento } from "./agent/eventos";
import { AlmacenSesiones } from "./domain/estado";
import { Fixtures } from "./domain/fixtures";
import type { ContextoHerramientas } from "./tools/proveedor";

const RE_SESION = /^[a-zA-Z0-9_-]{8,64}$/;
const fixtures = new Fixtures(config.fixtures);
const sesiones = new AlmacenSesiones();
const ocupadas = new Set<string>();
const salidaRaiz = resolve(config.dirSalida);

const crearContexto = (sesionId: string): ContextoHerramientas => {
  const dirSalida = join(salidaRaiz, sesionId);
  return {
    fixtures,
    sesion: sesiones.obtener(sesionId),
    fechaReferencia: config.fechaReferencia,
    dirSalida,
    urlDescarga: (ruta) => `/api/descargas/${sesionId}/${relative(dirSalida, ruta).split(sep).map(encodeURIComponent).join("/")}`,
  };
};

const agente: Agente = config.modo === "anthropic" ? new AgenteClaude(crearContexto) : new AgenteSimulado(crearContexto);

// ── Límite de peticiones por IP (ventana de 60 s) para proteger la URL pública y la API key
const ventanas = new Map<string, { inicio: number; n: number }>();
function limitar(ip: string): boolean {
  const ahora = Date.now();
  const v = ventanas.get(ip);
  if (!v || ahora - v.inicio > 60_000) {
    ventanas.set(ip, { inicio: ahora, n: 1 });
    return true;
  }
  v.n++;
  return v.n <= config.limitePorMinuto;
}

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

const ESTATICOS: Record<string, string> = { "/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/styles.css": "styles.css" };

const server = Bun.serve({
  port: config.puerto,
  idleTimeout: 255,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const ruta = url.pathname;

    if (req.method === "GET" && ESTATICOS[ruta]) return new Response(Bun.file(join(RAIZ, "public", ESTATICOS[ruta]!)));
    if (ruta === "/api/salud") return json({ ok: true, modo: config.modo });
    if (ruta === "/api/config") {
      return json({ modo: config.modo, modelo: config.modo === "anthropic" ? config.modelo : "simulado (sin LLM)", fecha_referencia: config.fechaReferencia, requiere_codigo: !!config.codigoAcceso });
    }

    if (ruta.startsWith("/api/")) {
      if (config.codigoAcceso && req.headers.get("x-access-code") !== config.codigoAcceso && url.searchParams.get("c") !== config.codigoAcceso) {
        return json({ error: "Código de acceso inválido" }, 401);
      }
    }

    // Descargas
    if (req.method === "GET" && ruta.startsWith("/api/descargas/")) {
      const [sesionId, ...resto] = ruta.slice("/api/descargas/".length).split("/").map(decodeURIComponent);
      if (!sesionId || !RE_SESION.test(sesionId)) return json({ error: "sesión inválida" }, 400);
      const base = join(salidaRaiz, sesionId);
      const archivo = resolve(base, ...resto);
      if (!archivo.startsWith(base + sep) || !existsSync(archivo) || !statSync(archivo).isFile()) return json({ error: "no encontrado" }, 404);
      const nombre = archivo.split(sep).pop()!;
      return new Response(Bun.file(archivo), { headers: { "content-disposition": `attachment; filename="${nombre}"` } });
    }

    if (req.method !== "POST") return json({ error: "no encontrado" }, 404);
    const ip = srv.requestIP(req)?.address ?? "?";
    if (!limitar(ip)) return json({ error: "Demasiadas peticiones, espera un minuto." }, 429);
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "JSON inválido" }, 400);
    }
    const sesionId = String(body.sesion_id ?? "");
    if (!RE_SESION.test(sesionId)) return json({ error: "sesion_id inválido" }, 400);

    if (ruta === "/api/reiniciar") {
      agente.reiniciar(sesionId);
      return json({ ok: true });
    }

    const mConf = ruta.match(/^\/api\/confirmaciones\/([A-Za-z0-9-]{5,100})$/);
    if (mConf) {
      const decision = body.decision === "aprobar" ? "aprobar" : body.decision === "rechazar" ? "rechazar" : null;
      if (!decision) return json({ error: "decision debe ser aprobar|rechazar" }, 400);
      try {
        const c = sesiones.obtener(sesionId).decidir(mConf[1]!, decision, "usuario-web", typeof body.comentario === "string" ? body.comentario.slice(0, 300) : undefined);
        return json({ ok: true, confirmacion: c });
      } catch (e) {
        return json({ error: (e as Error).message }, 409);
      }
    }

    if (ruta === "/api/chat") {
      const mensaje = String(body.mensaje ?? "").trim().slice(0, 4000);
      if (!mensaje) return json({ error: "mensaje vacío" }, 400);
      if (ocupadas.has(sesionId)) return json({ error: "Ya hay un turno en curso para esta sesión" }, 409);
      ocupadas.add(sesionId);
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const enviar = (e: Evento) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
          try {
            for await (const ev of agente.turno(sesionId, mensaje)) enviar(ev);
          } catch (e) {
            enviar({ tipo: "error", mensaje: (e as Error).message });
            enviar({ tipo: "fin" });
          } finally {
            ocupadas.delete(sesionId);
            controller.close();
          }
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
    }
    return json({ error: "no encontrado" }, 404);
  },
});

console.log(`Agente de proveedores en http://localhost:${server.port} · modo=${config.modo}${config.modo === "anthropic" ? ` · modelo=${config.modelo}` : ""} · fecha_referencia=${config.fechaReferencia}`);
