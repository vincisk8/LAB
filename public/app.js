// Frontend de chat (vanilla JS, sin build). Consume /api/chat por SSE (fetch + ReadableStream).
const $ = (s) => document.querySelector(s);
const mensajesEl = $("#mensajes");
const texto = $("#texto");
const btnEnviar = $("#btn-enviar");
let ocupado = false;
let codigo = "";

const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
let sesionId = leer("sesion_id") || nuevaSesion();
function nuevaSesion() {
  const id = "s_" + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 20) : Math.random().toString(36).slice(2) + Date.now());
  guardar("sesion_id", id);
  return id;
}

const cabeceras = () => ({ "content-type": "application/json", ...(codigo ? { "x-access-code": codigo } : {}) });

// ───────── Markdown mínimo y seguro (escapa HTML primero) ─────────
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function enlace(url) {
  if (!/^(https?:\/\/|\/api\/)/.test(url)) return null;
  if (url.startsWith("/api/") && codigo) url += (url.includes("?") ? "&" : "?") + "c=" + encodeURIComponent(codigo);
  return url;
}
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => { const ok = enlace(u.replace(/&amp;/g, "&")); return ok ? `<a href="${esc(ok)}" target="_blank" rel="noopener">${t}</a>` : t; });
}
function markdown(md) {
  const lineas = esc(md).split("\n");
  let html = "", i = 0;
  while (i < lineas.length) {
    const l = lineas[i];
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lineas.length && /^\s*\|[\s:|-]+\|\s*$/.test(lineas[i + 1])) {
      const celdas = (x) => x.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      html += "<table><thead><tr>" + celdas(l).map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>";
      i += 2;
      while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) { html += "<tr>" + celdas(lineas[i]).map((c) => `<td>${c}</td>`).join("") + "</tr>"; i++; }
      html += "</tbody></table>";
      continue;
    }
    if (/^\s*[-*•]\s+/.test(l)) {
      html += "<ul>";
      while (i < lineas.length && /^\s*[-*•]\s+/.test(lineas[i])) { html += `<li>${inline(lineas[i].replace(/^\s*[-*•]\s+/, ""))}</li>`; i++; }
      html += "</ul>";
      continue;
    }
    if (/^#{1,4}\s/.test(l)) { html += `<p><strong>${inline(l.replace(/^#+\s/, ""))}</strong></p>`; i++; continue; }
    if (l.trim()) html += `<p>${inline(l)}</p>`;
    i++;
  }
  return html;
}

// ───────── Render ─────────
function scroll() { mensajesEl.scrollTop = mensajesEl.scrollHeight; }
function limpiarBienvenida() { const b = mensajesEl.querySelector(".bienvenida"); if (b) b.remove(); }
function agregar(el) { limpiarBienvenida(); mensajesEl.appendChild(el); scroll(); return el; }
function burbuja(clase, contenido, esHtml = false) {
  const d = document.createElement("div");
  d.className = "msg " + clase;
  if (esHtml) d.innerHTML = contenido; else d.textContent = contenido;
  return agregar(d);
}

const herramientas = new Map();
const ETIQUETAS = {
  listar_casos: "Listar casos", leer_solicitud: "Leer solicitud", mapear_campos: "Mapear campos (glosario → repositorio)",
  consultar_repositorio: "Consultar repositorio", verificar_soportes: "Verificar vigencia de soportes", registrar_valor_manual: "Registrar valor del usuario",
  validar_datos: "Validar reglas obligatorias", llenar_formulario: "Llenar formulario (vista previa)", solicitar_confirmacion_humana: "Solicitar confirmación humana", armar_paquete: "Armar paquete para firma",
};
function herramientaInicio(ev) {
  const d = document.createElement("details");
  d.className = "herr";
  d.innerHTML = `<summary><span class="icono"><span class="spin"></span></span><span>🔧</span><span class="nombre">${esc(ev.nombre)}</span><span>${esc(ETIQUETAS[ev.nombre] || "")}</span><span class="estado">ejecutando…</span></summary>
    <div class="etq">Entrada</div><pre>${esc(JSON.stringify(ev.entrada, null, 2))}</pre><div class="etq salida-etq"></div><pre class="salida" hidden></pre>`;
  herramientas.set(ev.id, d);
  agregar(d);
}
function herramientaFin(ev) {
  const d = herramientas.get(ev.id);
  if (!d) return;
  d.classList.add(ev.ok ? "ok" : "fallo");
  d.querySelector(".icono").textContent = ev.ok ? "✓" : "✗";
  d.querySelector(".estado").textContent = `${ev.ok ? "ok" : "error"} · ${ev.ms} ms`;
  d.querySelector(".salida-etq").textContent = ev.ok ? "Resultado" : "Error";
  const pre = d.querySelector(".salida");
  pre.hidden = false;
  pre.textContent = JSON.stringify(ev.resultado, null, 2);
}
function tarjetaConfirmacion(c) {
  const d = document.createElement("div");
  d.className = "conf";
  d.innerHTML = `<h3>✋ Requiere tu confirmación <span class="modo ${c.modo}">${c.modo === "final" ? "Paquete final" : "Borrador"}</span></h3>
    <div><code>${esc(c.id)}</code> · caso <code>${esc(c.caso_id)}</code></div>
    <div class="resumen">${esc(c.resumen)}</div>
    <div class="acciones"><input placeholder="Comentario (opcional)" maxlength="300" />
      <button class="btn aprobar">✅ Aprobar y armar paquete</button><button class="btn rechazar">❌ Rechazar</button></div>
    <div class="resultado"></div>`;
  const [inp, ap, re] = [d.querySelector("input"), d.querySelector(".aprobar"), d.querySelector(".rechazar")];
  const decidir = async (decision) => {
    ap.disabled = re.disabled = inp.disabled = true;
    try {
      const r = await fetch(`/api/confirmaciones/${encodeURIComponent(c.id)}`, { method: "POST", headers: cabeceras(), body: JSON.stringify({ sesion_id: sesionId, decision, comentario: inp.value || undefined }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      d.classList.add("decidida");
      d.querySelector(".resultado").textContent = decision === "aprobar" ? "✅ Aprobado por ti. El agente continúa…" : "❌ Rechazado.";
      const msg = decision === "aprobar"
        ? `✅ Apruebo la confirmación ${c.id}. Arma el paquete.${inp.value ? " Comentario: " + inp.value : ""}`
        : `❌ Rechazo la confirmación ${c.id}.${inp.value ? " Motivo: " + inp.value : ""}`;
      enviar(msg);
    } catch (e) {
      d.querySelector(".resultado").textContent = "Error: " + e.message;
      ap.disabled = re.disabled = inp.disabled = false;
    }
  };
  ap.onclick = () => decidir("aprobar");
  re.onclick = () => decidir("rechazar");
  agregar(d);
}
function uso(ev) {
  const d = document.createElement("div");
  d.className = "uso";
  d.textContent = ev.iteraciones
    ? `🧮 ${ev.modelo} · ${ev.iteraciones} llamadas al modelo · ${ev.input_tokens.toLocaleString()} in / ${ev.output_tokens.toLocaleString()} out · caché ${ev.cache_read_tokens.toLocaleString()} leídos · ≈ US$ ${ev.costo_usd.toFixed(4)}`
    : `🧮 ${ev.modelo} · sin costo de LLM`;
  agregar(d);
}

// ───────── Envío y lectura SSE ─────────
async function enviar(mensaje) {
  if (ocupado || !mensaje.trim()) return;
  ocupado = true;
  btnEnviar.disabled = true;
  burbuja("usuario", mensaje);
  try {
    const r = await fetch("/api/chat", { method: "POST", headers: cabeceras(), body: JSON.stringify({ sesion_id: sesionId, mensaje }) });
    if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
    const lector = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await lector.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k;
      while ((k = buf.indexOf("\n\n")) >= 0) {
        const bloque = buf.slice(0, k); buf = buf.slice(k + 2);
        if (!bloque.startsWith("data: ")) continue;
        const ev = JSON.parse(bloque.slice(6));
        if (ev.tipo === "texto") burbuja("agente", markdown(ev.texto), true);
        else if (ev.tipo === "herramienta_inicio") herramientaInicio(ev);
        else if (ev.tipo === "herramienta_fin") herramientaFin(ev);
        else if (ev.tipo === "confirmacion") tarjetaConfirmacion(ev.confirmacion);
        else if (ev.tipo === "uso") uso(ev);
        else if (ev.tipo === "error") burbuja("error", ev.mensaje);
      }
    }
  } catch (e) {
    burbuja("error", "⚠️ " + e.message);
  } finally {
    ocupado = false;
    btnEnviar.disabled = false;
    texto.focus();
  }
}

$("#form").addEventListener("submit", (e) => { e.preventDefault(); const m = texto.value; texto.value = ""; texto.style.height = "auto"; enviar(m); });
texto.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#form").requestSubmit(); } });
texto.addEventListener("input", () => { texto.style.height = "auto"; texto.style.height = Math.min(texto.scrollHeight, 160) + "px"; });
document.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => enviar(b.dataset.msg)));
$("#btn-reiniciar").addEventListener("click", async () => {
  await fetch("/api/reiniciar", { method: "POST", headers: cabeceras(), body: JSON.stringify({ sesion_id: sesionId }) }).catch(() => {});
  sesionId = nuevaSesion();
  mensajesEl.innerHTML = '<div class="bienvenida"><h2>Nueva sesión</h2><p>Elige un caso o escribe tu solicitud.</p></div>';
});

(async () => {
  const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
  const b = $("#badge-modo");
  b.textContent = cfg.modo === "anthropic" ? `🤖 ${cfg.modelo}` : "🧪 Modo simulado (sin LLM)";
  b.classList.add(cfg.modo === "anthropic" ? "llm" : "sim");
  $("#badge-fecha").textContent = `📅 Vigencias a ${cfg.fecha_referencia || "?"}`;
  if (cfg.requiere_codigo) {
    codigo = leer("codigo_acceso") || prompt("Código de acceso a la demo:") || "";
    guardar("codigo_acceso", codigo);
  }
})();
