---
name: registro-proveedor
description: Conocimiento del proceso de registro como proveedor de Periferia (identificador tributario por país, soportes y vigencias, datos bancarios, confirmación humana). Usar al procesar solicitudes de registro de clientes.
---

# Conocimiento del proceso: registro como proveedor

## Qué es

Los clientes de Periferia (Colombia, Ecuador, Perú, Panamá y Honduras) piden registrarla como proveedor. Cada solicitud llega por correo e incluye tres cosas:

- una plantilla de campos;
- el formato de salida: Excel (`xlsx`), formulario PDF (`pdf`) o portal web (`portal`);
- la lista de soportes exigidos.

Los datos ya existen en el repositorio maestro (`maestro.json`) y los soportes en `repositorio/soportes/`.

## Flujo estándar

1. **Leer la solicitud**: cliente, país, formato, campos y soportes.
2. **Mapear** cada campo al maestro usando el glosario de sinónimos. El resultado es uno de tres estados:
   - `lleno`: valor encontrado, con la ruta del dato en el maestro.
   - `faltante`: no existe en el maestro. **Nunca se inventa.**
   - `requiere_confirmacion`: mapeo con confianza menor a 0,8, campo ambiguo o regla de país.
3. **Generar** el formulario en el formato pedido:
   - **Excel:** la etiqueta y el valor van en la hoja y la celda indicadas.
   - **PDF:** etiqueta y valor en el orden de la plantilla.
   - **Portal:** formato no soportado. Se generan los valores listos para copiar (`valores-portal.md`).
4. **Armar el paquete para firma**: formulario, soportes exigidos, `checklist.md` y `borrador-correo.md`.
5. **Preguntar** al usuario si confirma el envío. Solo con una confirmación explícita en el mensaje siguiente se simula el envío (`ENVIO-SIMULADO.md`).

## Identificador tributario por país (RN1)

| País | Identificador |
|---|---|
| Colombia (CO) | NIT |
| Ecuador (EC) | RUC |
| Perú (PE) | RUC |
| Panamá (PA) | RUC |
| Honduras (HN) | RTN |

Periferia solo tiene NIT colombiano.

- **Cliente fuera de Colombia:** el campo se llena con el NIT y queda en `requiere_confirmacion` con la nota "identificador extranjero".
- **Etiqueta genérica** ("Identificación tributaria", "Tax ID"): es ambigua. Se propone el identificador del país y queda en `requiere_confirmacion`.

## Datos bancarios (RN2)

- Se llenan solo si la plantilla los pide explícitamente.
- **Nunca** van en el borrador de correo.

## Soportes (RN3)

| Estado | Condición | ¿Bloquea `listo_para_firma`? |
|---|---|---|
| `presente` | Existe en el repositorio y su `vigencia_hasta` es igual o posterior a la fecha de ejecución (o no tiene vencimiento) | No |
| `vencido` | `vigencia_hasta` es anterior a la fecha de ejecución | **Sí** |
| `ausente` | El cliente lo exige y no está en el repositorio | **Sí** |

Un campo `faltante` **no** bloquea `listo_para_firma`, pero aparece en el checklist para que la analista lo complete.

Tipos de soporte habituales:

- `camara_comercio`: certificado de existencia y representación legal.
- `rut`: registro único tributario.
- `certificacion_bancaria`
- `parafiscales`: aportes a seguridad social y parafiscales.
- `estados_financieros`

## Acciones externas (RN4)

El agente **nunca** firma, envía ni carga nada en un portal. "Enviar" en este reto solo simula el envío escribiendo `ENVIO-SIMULADO.md`, y exige dos cosas:

1. Que el agente haya cerrado su turno anterior con una pregunta explícita de confirmación.
2. Que el mensaje inmediatamente siguiente del usuario la confirme, por ejemplo "sí", "confirmo" o "envía".

Una frase como "no envíes nada todavía" no es una confirmación.

## Portales web

- **El humano:** ingresa las credenciales y hace clic en "Enviar".
- **El agente:** solo prepara los valores en un formato copiable.

## Qué responder a la analista

- Qué campos quedaron llenos, cuáles faltan y cuáles requieren confirmación (con su nota).
- La ruta de los archivos en `out/<caso>/`.
- Si el paquete está listo para firma y, si no lo está, qué soportes debe actualizar o conseguir.
- Al final, una pregunta explícita sobre el envío.
