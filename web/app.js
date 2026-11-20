// Front de chat (HTML + JS sin build). Consume POST /api/chat como stream SSE.
const $ = (s) => document.querySelector(s);
const mensajesEl = $("#mensajes");
const texto = $("#texto");
const btnEnviar = $("#btn-enviar");
let ocupado = false;
let codigo = "";

const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const nuevaSesion = () => { const id = "s_" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); guardar("sessionId", id); return id; };
let sessionId = leer("sessionId") || nuevaSesion();
const cabeceras = () => ({ "content-type": "application/json", ...(codigo ? { "x-access-code": codigo } : {}) });

// ───────── Markdown mínimo y seguro ─────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function enlaceArchivo(ruta) {
  const r = ruta.replace(/^out\//, "");
  return `/api/archivos/${r.split("/").map(encodeURIComponent).join("/")}${codigo ? "?c=" + encodeURIComponent(codigo) : ""}`;
}
function inline(s) {
  return s
    .replace(/`(out\/[^`]+\.(?:xlsx|pdf|md|txt))`/g, (m, r) => `<a href="${esc(enlaceArchivo(r.replace(/&amp;/g, "&")))}" target="_blank"><code>${r}</code></a>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}
function markdown(md) {
  const l = esc(md).split("\n");
  let html = "", i = 0;
  while (i < l.length) {
    if (/^\s*\|.*\|\s*$/.test(l[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(l[i + 1] || "")) {
      const celdas = (x) => x.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      html += "<table><thead><tr>" + celdas(l[i]).map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>";
      i += 2;
      while (i < l.length && /^\s*\|.*\|\s*$/.test(l[i])) html += "<tr>" + celdas(l[i++]).map((c) => `<td>${c}</td>`).join("") + "</tr>";
      html += "</tbody></table>";
      continue;
    }
    if (/^\s*[-*]\s+/.test(l[i])) {
      html += "<ul>";
      while (i < l.length && /^\s*[-*]\s+/.test(l[i])) html += `<li>${inline(l[i++].replace(/^\s*[-*]\s+/, ""))}</li>`;
      html += "</ul>";
      continue;
    }
    if (/^#{1,4}\s/.test(l[i])) html += `<p><strong>${inline(l[i].replace(/^#+\s/, ""))}</strong></p>`;
    else if (l[i].trim()) html += `<p>${inline(l[i])}</p>`;
    i++;
  }
  return html;
}

// ───────── Render ─────────
const scroll = () => (mensajesEl.scrollTop = mensajesEl.scrollHeight);
function agregar(el) { mensajesEl.querySelector(".bienvenida")?.remove(); mensajesEl.appendChild(el); scroll(); return el; }
function burbuja(clase, html) { const d = document.createElement("div"); d.className = "msg " + clase; d.innerHTML = html; return agregar(d); }
function pensando(on) {
  mensajesEl.querySelector(".pensando")?.remove();
  if (on) { const d = document.createElement("div"); d.className = "pensando"; d.innerHTML = '<span class="puntos"><span></span><span></span><span></span></span> pensando…'; agregar(d); }
}
const herramientas = new Map();
function herramienta(nombre, argumentos, id) {
  const d = document.createElement("details");
  d.className = "herr";
  d.innerHTML = `<summary><span class="icono"><span class="spin"></span></span>🔧 <span class="nombre">${esc(nombre)}</span><span class="resumen"></span><span class="estado">ejecutando…</span></summary>
    <div class="etq">Argumentos</div><pre>${esc(JSON.stringify(argumentos, null, 2))}</pre><div class="etq salida-etq"></div><pre class="salida" hidden></pre>`;
  if (id) herramientas.set(id, d);
  return agregar(d);
}
function herramientaFin(d, ok, resumen, resultado) {
  d.classList.add(ok ? "ok" : "fallo");
  d.querySelector(".icono").textContent = ok ? "✓" : "✗";
  d.querySelector(".estado").textContent = ok ? "ok" : "error";
  d.querySelector(".resumen").textContent = resumen || "";
  if (resultado !== undefined) {
    d.querySelector(".salida-etq").textContent = "Resultado";
    const pre = d.querySelector(".salida"); pre.hidden = false; pre.textContent = JSON.stringify(resultado, null, 2);
  }
}
function bannerConfirmacion(ultimaBurbuja) {
  ultimaBurbuja?.classList.add("pide-confirmacion");
  const b = document.createElement("div");
  b.className = "banner-conf";
  b.innerHTML = `<strong>✋ El agente espera tu confirmación explícita antes de simular el envío.</strong>
    <button class="btn aprobar">Sí, confirmo el envío</button><button class="btn rechazar">No, todavía no</button>`;
  const cerrar = () => b.querySelectorAll("button").forEach((x) => (x.disabled = true));
  b.querySelector(".aprobar").onclick = () => { cerrar(); enviar("Sí, confirmo. Envía el paquete."); };
  b.querySelector(".rechazar").onclick = () => { cerrar(); enviar("No, todavía no lo envíes."); };
  agregar(b);
}

// ───────── Envío (SSE) ─────────
async function enviar(mensaje) {
  if (ocupado || !mensaje.trim()) return;
  ocupado = true; btnEnviar.disabled = true;
  burbuja("usuario", esc(mensaje));
  let ultima = null;
  try {
    const r = await fetch("/api/chat", { method: "POST", headers: { ...cabeceras(), accept: "text/event-stream" }, body: JSON.stringify({ sessionId, message: mensaje }) });
    if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
    const lector = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { value, done } = await lector.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k;
      while ((k = buf.indexOf("\n\n")) >= 0) {
        const bloque = buf.slice(0, k); buf = buf.slice(k + 2);
        if (!bloque.startsWith("data: ")) continue;
        const ev = JSON.parse(bloque.slice(6));
        if (ev.tipo === "pensando") pensando(true);
        else if (ev.tipo === "texto") { pensando(false); ultima = burbuja("agente", markdown(ev.texto)); }
        else if (ev.tipo === "herramienta_inicio") { pensando(false); herramienta(ev.nombre, ev.argumentos, ev.id); }
        else if (ev.tipo === "herramienta_fin") { const d = herramientas.get(ev.id); if (d) herramientaFin(d, ev.ok, ev.resumen, ev.resultado); }
        else if (ev.tipo === "error") { pensando(false); burbuja("error", "⚠️ " + esc(ev.mensaje)); }
        else if (ev.tipo === "fin") { pensando(false); if (ev.needsConfirmation) bannerConfirmacion(ultima); }
      }
    }
  } catch (e) {
    pensando(false); burbuja("error", "⚠️ " + esc(e.message));
  } finally {
    ocupado = false; btnEnviar.disabled = false; texto.focus();
  }
}

async function restaurar() {
  const r = await fetch(`/api/sessions/${sessionId}`, { headers: cabeceras() }).catch(() => null);
  if (!r || !r.ok) return;
  const historial = await r.json();
  let ultima = null, pide = false;
  for (const e of historial) {
    if (e.rol === "user") burbuja("usuario", esc(e.texto));
    if (e.rol === "error") burbuja("error", "⚠️ " + esc(e.texto));
    if (e.rol === "assistant") {
      for (const t of e.toolCalls || []) herramientaFin(herramienta(t.nombre, t.argumentos), t.ok, t.resumen);
      if (e.texto) ultima = burbuja("agente", markdown(e.texto));
      pide = !!e.needsConfirmation;
    }
  }
  if (pide) bannerConfirmacion(ultima);
}

$("#form").addEventListener("submit", (e) => { e.preventDefault(); const m = texto.value; texto.value = ""; texto.style.height = "auto"; enviar(m); });
texto.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#form").requestSubmit(); } });
texto.addEventListener("input", () => { texto.style.height = "auto"; texto.style.height = Math.min(texto.scrollHeight, 160) + "px"; });
document.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => enviar(b.dataset.msg)));
$("#btn-reiniciar").addEventListener("click", async () => {
  await fetch(`/api/sessions/${sessionId}/reset`, { method: "POST", headers: cabeceras() }).catch(() => {});
  sessionId = nuevaSesion();
  mensajesEl.innerHTML = '<div class="bienvenida"><h2>Nueva sesión</h2><p>Elige un caso o escribe tu solicitud.</p></div>';
});

(async () => {
  const h = await fetch("/api/health").then((r) => r.json()).catch(() => ({}));
  const b = $("#badge-modelo");
  b.textContent = h.provider === "simulado" ? "🧪 Simulado (sin LLM)" : `🤖 ${h.provider} · ${h.model}`;
  b.classList.add(h.provider === "simulado" ? "sim" : "llm");
  if (h.requiere_codigo) { codigo = leer("codigo") || prompt("Clave de acceso (ver README):") || ""; guardar("codigo", codigo); }
  await restaurar();
})();
