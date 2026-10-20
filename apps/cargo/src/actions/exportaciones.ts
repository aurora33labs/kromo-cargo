import { defineAction } from "@kromo/core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { aCsv, fechaSchema, hoy, round2 } from "../lib.ts";

function guardar(dataDir: string, prefijo: string, csv: string) {
  const dir = join(dataDir, "exportaciones");
  mkdirSync(dir, { recursive: true });
  const nombre = `${prefijo}-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}.csv`;
  writeFileSync(join(dir, nombre), csv);
  return { ruta: join(dir, nombre), nombre };
}

export const exportarVentas = defineAction({
  name: "exportar_ventas",
  title: "Exportar ventas",
  description: "Exporta a CSV las ventas de un rango de fechas (por defecto los últimos 30 días): una fila por producto vendido. Regresa la ruta y el enlace del archivo.",
  kind: "accion",
  input: z.object({
    desde: fechaSchema.optional().describe("AAAA-MM-DD, incluido"),
    hasta: fechaSchema.optional().describe("AAAA-MM-DD, incluido"),
  }),
  run: async ({ desde, hasta }, { db, dataDir, setResumen, urlArchivo }) => {
    const d = desde ?? hoy(-29);
    const h = hasta ?? hoy(0);
    const filas = (
      await db.all(
        `SELECT v.id AS venta, v.creado_en AS fecha, v.metodo_pago, p.sku, p.nombre AS producto, p.categoria,
                -m.cantidad AS cantidad, m.precio_unitario, -m.cantidad * m.precio_unitario AS importe,
                -m.cantidad * COALESCE(m.costo_unitario, 0) AS costo, v.nota
         FROM movimientos m JOIN ventas v ON v.id = m.venta_id JOIN productos p ON p.id = m.producto_id
         WHERE m.tipo = 'venta' AND v.anulada = 0 AND v.creado_en BETWEEN ? AND ? ORDER BY v.id, m.id`,
        [d + " 00:00:00", h + " 23:59:59"],
      )
    ).map((r) => ({ ...r, importe: round2(Number(r.importe)), costo: round2(Number(r.costo)) }));
    const cols = ["venta", "fecha", "metodo_pago", "sku", "producto", "categoria", "cantidad", "precio_unitario", "importe", "costo", "nota"];
    const { ruta, nombre } = guardar(dataDir, `ventas-${d}-a-${h}`, aCsv(cols, filas));
    setResumen(`Exportó ${filas.length} líneas de venta (${d} a ${h})`);
    return { ruta, url: urlArchivo(`/archivos/exportaciones/${nombre}`), lineas: filas.length, desde: d, hasta: h };
  },
});

export const exportarHistorial = defineAction({
  name: "exportar_historial",
  title: "Exportar historial",
  description: "Exporta a CSV el historial de acciones (quién hizo qué y cuándo, personas e IAs). Regresa la ruta y el enlace del archivo.",
  kind: "accion",
  input: z.object({ limite: z.number().int().min(1).max(50000).default(5000).describe("Máximo de registros, los más recientes") }),
  run: async ({ limite }, { db, dataDir, setResumen, urlArchivo }) => {
    const filas = (
      await db.all(
        `SELECT id, creado_en AS fecha, actor_tipo, actor_usuario, actor_cliente, accion, resumen, deshecho_en
         FROM historial ORDER BY id DESC LIMIT ?`,
        [limite],
      )
    ).map((r) => ({ ...r, actor_tipo: r.actor_tipo === "ia" ? "IA" : "persona" }));
    const cols = ["id", "fecha", "actor_tipo", "actor_usuario", "actor_cliente", "accion", "resumen", "deshecho_en"];
    const { ruta, nombre } = guardar(dataDir, "historial", aCsv(cols, filas));
    setResumen(`Exportó ${filas.length} registros del historial`);
    return { ruta, url: urlArchivo(`/archivos/exportaciones/${nombre}`), registros: filas.length };
  },
});
