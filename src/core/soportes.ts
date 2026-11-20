/** Evaluación de soportes exigidos contra el índice del repositorio (HU-4, RN3). */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SoporteIndice } from "./insumos";
import { reglas } from "./reglas";
import { slug } from "./texto";

export interface EstadoSoporte {
  exigido: string;
  tipo: string;
  estado: "presente" | "vencido" | "ausente";
  archivo: string | null;
  vigencia_hasta: string | null;
  pais_emisor: string | null;
  motivo: string;
}

/** Resuelve el nombre que usa el cliente ("Cámara de Comercio") al tipo del índice ("camara_comercio"). */
export function tipoDeSoporte(exigido: string, tipos: string[]): string {
  const s = slug(exigido);
  const directo = tipos.find((t) => slug(t) === s);
  if (directo) return directo;
  for (const [tipo, alias] of Object.entries(reglas.alias_soportes)) {
    if (slug(tipo) === s || alias.some((a) => slug(a) === s)) return tipos.find((t) => slug(t) === slug(tipo)) ?? tipo;
  }
  return s;
}

const vence = (s: SoporteIndice) => s.vigencia_hasta ?? "9999-12-31";

export function evaluarSoportes(exigidos: string[], indice: SoporteIndice[], fecha: string, dirSoportes: string): EstadoSoporte[] {
  const tipos = [...new Set(indice.map((s) => s.tipo))];
  return exigidos.map((exigido) => {
    const tipo = tipoDeSoporte(exigido, tipos);
    const candidatos = indice.filter((s) => slug(s.tipo) === slug(tipo)).sort((a, b) => vence(b).localeCompare(vence(a)));
    const doc = candidatos[0];
    const base = { exigido, tipo, archivo: doc?.archivo ?? null, vigencia_hasta: doc?.vigencia_hasta ?? null, pais_emisor: doc?.pais_emisor ?? null };
    if (!doc) return { ...base, estado: "ausente" as const, motivo: "No existe en el repositorio de soportes." };
    if (!existsSync(join(dirSoportes, doc.archivo))) return { ...base, estado: "ausente" as const, motivo: `El índice lo referencia pero falta el archivo ${doc.archivo}.` };
    if (doc.vigencia_hasta && doc.vigencia_hasta < fecha) {
      return { ...base, estado: "vencido" as const, motivo: `Venció el ${doc.vigencia_hasta} (fecha de ejecución ${fecha}). Solicitar uno actualizado.` };
    }
    return { ...base, estado: "presente" as const, motivo: doc.vigencia_hasta ? `Vigente hasta ${doc.vigencia_hasta}.` : "Sin fecha de vencimiento." };
  });
}
