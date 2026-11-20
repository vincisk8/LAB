/** Carga y valida las reglas de negocio de src/knowledge/reglas.json. */
import { z } from "zod";
import reglasJson from "../knowledge/reglas.json";

const EsquemaReglas = z.object({
  pais_maestro: z.string(),
  paises: z.record(z.string(), z.object({ nombre: z.string(), identificador_tributario: z.string() })),
  claves_identificador_tributario: z.array(z.string()),
  etiquetas_identificador_ambiguas: z.array(z.string()),
  claves_bancarias: z.array(z.string()),
  umbral_confianza: z.number().min(0).max(1),
  umbral_minimo: z.number().min(0).max(1),
  alias_soportes: z.record(z.string(), z.array(z.string())),
  confirmacion: z.object({ afirmativas: z.array(z.string()), negativas: z.array(z.string()) }),
});

export type Reglas = z.infer<typeof EsquemaReglas>;

export const reglas: Reglas = EsquemaReglas.parse(reglasJson);
