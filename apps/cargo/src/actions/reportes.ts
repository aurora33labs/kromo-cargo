import { defineAction, type Db } from "@kromo/core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ahora, fechaSchema, getConfig, hoy, positivo, round2 } from "../lib.ts";
import { listarProductos } from "./productos.ts";

const n = (v: unknown) => Number(v ?? 0);

/** Unidades vendidas por producto en los últimos n días (ventas no anuladas). */
async function ventasPorProducto(db: Db, dias: number): Promise<Map<number, number>> {
  const rows = await db.all<{ producto_id: number; unidades: number }>(
    `SELECT m.producto_id, -SUM(m.cantidad) AS unidades
     FROM movimientos m JOIN ventas v ON v.id = m.venta_id
     WHERE m.tipo = 'venta' AND v.anulada = 0 AND v.creado_en >= ?
     GROUP BY m.producto_id`,
    [ahora(-dias)],
  );
  return new Map(rows.map((r) => [n(r.producto_id), n(r.unidades)]));
}

export async function calcularStockBajo(db: Db, dias: number) {
  const productos = await listarProductos(db);
  const vendidas = await ventasPorProducto(db, 30);
  return productos
    .map((p) => {
      const promedio = (vendidas.get(p.id) ?? 0) / 30;
      const dias_restantes = promedio > 0 ? Math.max(0, p.stock) / promedio : null;
      const objetivo = Math.max(p.stock_minimo * 2, promedio * dias * 2);
      return {
        id: p.id,
        nombre: p.nombre,
        categoria: p.categoria,
        proveedor: p.proveedor,
        stock: round2(p.stock),
        stock_minimo: p.stock_minimo,
        venta_diaria_promedio: round2(promedio),
        dias_restantes: dias_restantes === null ? null : Math.floor(dias_restantes),
        sugerido_pedir: Math.max(0, Math.ceil(objetivo - p.stock)),
        motivo: p.stock <= p.stock_minimo ? "debajo del mínimo" : "se acaba pronto al ritmo actual",
      };
    })
    .filter((r) => r.stock <= r.stock_minimo || (r.dias_restantes !== null && r.dias_restantes <= dias))
    .sort((a, b) => (a.dias_restantes ?? (a.stock <= 0 ? -1 : 9999)) - (b.dias_restantes ?? (b.stock <= 0 ? -1 : 9999)) || a.stock - b.stock);
}

export const productosStockBajo = defineAction({
  name: "productos_stock_bajo",
  title: "Productos por agotarse",
  description:
    "Responde '¿qué se me acaba?': productos debajo de su mínimo o que se agotarán en los próximos N días según el ritmo de venta de los últimos 30 días, con cantidad sugerida a pedir.",
  kind: "lectura",
  input: z.object({ dias: z.number().int().min(1).max(90).default(7).describe("Horizonte en días") }),
  run: async ({ dias }, { db }) => {
    const productos = await calcularStockBajo(db, dias);
    return { horizonte_dias: dias, total: productos.length, productos };
  },
});

export const reporteVentas = defineAction({
  name: "reporte_ventas",
  title: "Reporte de ventas",
  description:
    "Ventas en un rango de fechas (por defecto los últimos 30 días): totales, utilidad bruta estimada, agrupación por día, producto, categoría o método de pago, y top de productos.",
  kind: "lectura",
  input: z.object({
    desde: fechaSchema.optional().describe("AAAA-MM-DD, incluido"),
    hasta: fechaSchema.optional().describe("AAAA-MM-DD, incluido"),
    agrupar: z.enum(["dia", "producto", "categoria", "metodo_pago"]).default("dia"),
  }),
  run: async ({ desde, hasta, agrupar }, { db }) => {
    const d = desde ?? hoy(-29);
    const h = hasta ?? hoy(0);
    const rango = [d + " 00:00:00", h + " 23:59:59"];
    const base = `FROM movimientos m JOIN ventas v ON v.id = m.venta_id JOIN productos p ON p.id = m.producto_id
                  WHERE m.tipo = 'venta' AND v.anulada = 0 AND v.creado_en BETWEEN ? AND ?`;
    const t = (await db.get(
      `SELECT CAST(COUNT(DISTINCT v.id) AS INTEGER) AS ventas, COALESCE(SUM(-m.cantidad * m.precio_unitario),0) AS importe,
              COALESCE(SUM(-m.cantidad),0) AS unidades, COALESCE(SUM(-m.cantidad * COALESCE(m.costo_unitario,0)),0) AS costo ${base}`,
      rango,
    ))!;
    const clave = {
      dia: "substr(v.creado_en, 1, 10)",
      producto: "p.nombre",
      categoria: "COALESCE(p.categoria, 'Sin categoría')",
      metodo_pago: "v.metodo_pago",
    }[agrupar];
    const filas = (
      await db.all(
        `SELECT ${clave} AS grupo, CAST(COUNT(DISTINCT v.id) AS INTEGER) AS ventas, SUM(-m.cantidad) AS unidades,
                SUM(-m.cantidad * m.precio_unitario) AS importe ${base} GROUP BY ${clave} ORDER BY ${agrupar === "dia" ? "1" : "importe DESC"}`,
        rango,
      )
    ).map((r) => ({ grupo: r.grupo, ventas: n(r.ventas), unidades: round2(n(r.unidades)), importe: round2(n(r.importe)) }));
    const top = (
      await db.all(
        `SELECT p.id, p.nombre, SUM(-m.cantidad) AS unidades, SUM(-m.cantidad * m.precio_unitario) AS importe
         ${base} GROUP BY p.id, p.nombre ORDER BY importe DESC LIMIT 10`,
        rango,
      )
    ).map((r) => ({ id: n(r.id), nombre: r.nombre, unidades: round2(n(r.unidades)), importe: round2(n(r.importe)) }));
    const importe = n(t.importe);
    const ventas = n(t.ventas);
    const utilidad = round2(importe - n(t.costo));
    return {
      desde: d,
      hasta: h,
      totales: {
        ventas,
        importe: round2(importe),
        unidades: round2(n(t.unidades)),
        ticket_promedio: ventas ? round2(importe / ventas) : 0,
        utilidad_bruta_estimada: utilidad,
        margen_porcentaje: importe ? round2((utilidad / importe) * 100) : 0,
      },
      agrupado_por: agrupar,
      filas,
      top_productos: top,
    };
  },
});

export const valorInventario = defineAction({
  name: "valor_inventario",
  title: "Valor del inventario",
  description: "Cuánto vale el inventario actual al costo y al precio de venta, total y por categoría.",
  kind: "lectura",
  input: z.object({}),
  run: async (_i, { db }) => {
    const s = positivo("e.stock");
    const filas = (
      await db.all(
        `SELECT COALESCE(p.categoria,'Sin categoría') AS categoria, CAST(COUNT(*) AS INTEGER) AS productos,
                SUM(${s}) AS unidades, SUM(${s} * p.costo) AS valor_costo, SUM(${s} * p.precio) AS valor_precio
         FROM productos p JOIN existencias e ON e.producto_id = p.id WHERE p.activo = 1
         GROUP BY COALESCE(p.categoria,'Sin categoría') ORDER BY valor_costo DESC`,
      )
    ).map((r) => ({
      categoria: r.categoria,
      productos: n(r.productos),
      unidades: round2(n(r.unidades)),
      valor_costo: round2(n(r.valor_costo)),
      valor_precio: round2(n(r.valor_precio)),
    }));
    const total_costo = round2(filas.reduce((a, r) => a + r.valor_costo, 0));
    const total_precio = round2(filas.reduce((a, r) => a + r.valor_precio, 0));
    const negativos = await db.all(
      `SELECT p.id, p.nombre, e.stock FROM productos p JOIN existencias e ON e.producto_id = p.id WHERE p.activo = 1 AND e.stock < 0`,
    );
    return {
      total_costo,
      total_precio,
      utilidad_potencial: round2(total_precio - total_costo),
      por_categoria: filas,
      ...(negativos.length ? { advertencia: "Hay productos con stock negativo; conviene hacer un conteo.", stock_negativo: negativos } : {}),
    };
  },
});

export const productosSinMovimiento = defineAction({
  name: "productos_sin_movimiento",
  title: "Productos sin venta",
  description: "Productos con existencias que no se han vendido en N días (dinero detenido en anaquel).",
  kind: "lectura",
  input: z.object({ dias: z.number().int().min(1).max(365).default(30) }),
  run: async ({ dias }, { db }) => {
    const vendidos = await ventasPorProducto(db, dias);
    const productos = (await listarProductos(db))
      .filter((p) => p.stock > 0 && !vendidos.has(p.id))
      .map((p) => ({ id: p.id, nombre: p.nombre, categoria: p.categoria, stock: round2(p.stock), valor_costo: round2(p.stock * p.costo) }))
      .sort((a, b) => b.valor_costo - a.valor_costo);
    return { dias, total: productos.length, valor_detenido: round2(productos.reduce((a, p) => a + p.valor_costo, 0)), productos };
  },
});

export function leerServidor(dataDir: string): { url: string; pid: number } | null {
  const f = join(dataDir, "servidor.json");
  if (!existsSync(f)) return null;
  try {
    const info = JSON.parse(readFileSync(f, "utf8"));
    process.kill(info.pid, 0); // ¿sigue vivo?
    return info;
  } catch {
    return null;
  }
}

export async function calcularResumen(db: Db, dataDir: string) {
  const cfg = await getConfig(db);
  const ventasDesde = (desde: string) =>
    db.get(`SELECT CAST(COUNT(*) AS INTEGER) AS ventas, COALESCE(SUM(total),0) AS importe FROM ventas WHERE anulada = 0 AND creado_en >= ?`, [desde]);
  const hoyV = (await ventasDesde(hoy(0) + " 00:00:00"))!;
  const semana = (await ventasDesde(hoy(-6) + " 00:00:00"))!;
  const productos = (await db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM productos WHERE activo = 1"))!;
  const valor = (await db.get(
    `SELECT COALESCE(SUM(${positivo("e.stock")} * p.costo),0) AS v FROM productos p JOIN existencias e ON e.producto_id = p.id WHERE p.activo = 1`,
  ))!;
  const bajos = await calcularStockBajo(db, 7);
  const servidor = leerServidor(dataDir);
  return {
    negocio: cfg.nombre_negocio,
    fecha: hoy(0),
    productos_activos: n(productos.n),
    ventas_hoy: { ventas: n(hoyV.ventas), importe: round2(n(hoyV.importe)) },
    ventas_7_dias: { ventas: n(semana.ventas), importe: round2(n(semana.importe)) },
    valor_inventario_costo: round2(n(valor.v)),
    por_agotarse: { total: bajos.length, primeros: bajos.slice(0, 5).map((b) => ({ id: b.id, nombre: b.nombre, stock: b.stock, dias_restantes: b.dias_restantes })) },
    app: servidor ? { abierta: true, url: servidor.url } : { abierta: false, como_abrir: "Ejecuta `kromo-cargo serve` en una terminal" },
  };
}

export const resumen = defineAction({
  name: "resumen",
  title: "Resumen del negocio",
  description:
    "Foto rápida del negocio: ventas de hoy y de la semana, productos activos, valor del inventario y lo que está por agotarse. Buen primer paso antes de cualquier otra consulta.",
  kind: "lectura",
  input: z.object({}),
  run: (_i, { db, dataDir }) => calcularResumen(db, dataDir),
});
