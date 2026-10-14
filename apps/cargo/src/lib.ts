import { ActionError, ahora, hoy, type Db } from "@kromo/core";
import { z } from "zod";

export { ahora, hoy };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const money = (n: number) =>
  "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Expresión SQL portable para max(x, 0). */
export const positivo = (expr: string) => `CASE WHEN ${expr} > 0 THEN ${expr} ELSE 0 END`;

export interface ProductoRow {
  id: number;
  nombre: string;
  sku: string | null;
  codigo_barras: string | null;
  categoria: string | null;
  descripcion: string | null;
  precio: number;
  costo: number;
  unidad: string;
  stock_minimo: number;
  proveedor: string | null;
  notas: string | null;
  foto: string | null;
  activo: number;
  creado_en: string;
  actualizado_en: string;
  stock: number;
}

export const PRODUCTO_SELECT = `
  SELECT p.*, COALESCE(e.stock, 0) AS stock
  FROM productos p LEFT JOIN existencias e ON e.producto_id = p.id`;

/** Referencia flexible a un producto: por id o por código (SKU o código de barras). */
export const refProducto = {
  producto_id: z.number().int().optional().describe("id del producto"),
  codigo: z.string().optional().describe("SKU o código de barras (alternativa a producto_id)"),
};

export async function getProducto(db: Db, ref: { producto_id?: number; codigo?: string }): Promise<ProductoRow> {
  let row: ProductoRow | null = null;
  if (ref.producto_id !== undefined) {
    row = await db.get<ProductoRow>(`${PRODUCTO_SELECT} WHERE p.id = ?`, [ref.producto_id]);
    if (!row) throw new ActionError(`No existe el producto con id ${ref.producto_id}.`);
  } else if (ref.codigo) {
    const c = ref.codigo.trim();
    row = await db.get<ProductoRow>(`${PRODUCTO_SELECT} WHERE LOWER(p.sku) = LOWER(?) OR p.codigo_barras = ?`, [c, c]);
    if (!row) throw new ActionError(`No existe un producto con el código "${ref.codigo}".`);
  } else {
    throw new ActionError("Indica producto_id o codigo.");
  }
  return row;
}

export function productoPublico(p: ProductoRow) {
  return {
    id: p.id,
    nombre: p.nombre,
    sku: p.sku,
    codigo_barras: p.codigo_barras,
    categoria: p.categoria,
    descripcion: p.descripcion,
    precio: p.precio,
    costo: p.costo,
    unidad: p.unidad,
    stock: round2(p.stock),
    stock_minimo: p.stock_minimo,
    stock_bajo: p.stock <= p.stock_minimo,
    proveedor: p.proveedor,
    notas: p.notas,
    foto: p.foto ? `/archivos/fotos/${p.foto}` : null,
    activo: !!Number(p.activo),
  };
}

export async function getConfig(db: Db): Promise<Record<string, string>> {
  const rows = await db.all<{ clave: string; valor: string }>("SELECT clave, valor FROM configuracion");
  return Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
}

export type TipoMovimiento = "inicial" | "entrada" | "venta" | "merma" | "ajuste" | "anulacion";

export function insertMovimiento(
  db: Db,
  m: {
    producto_id: number;
    tipo: TipoMovimiento;
    cantidad: number;
    costo_unitario?: number | null;
    precio_unitario?: number | null;
    motivo?: string | null;
    proveedor?: string | null;
    venta_id?: number | null;
    creado_en?: string;
  },
): Promise<number> {
  return db.insert(
    `INSERT INTO movimientos (producto_id, tipo, cantidad, costo_unitario, precio_unitario, motivo, proveedor, venta_id, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      m.producto_id,
      m.tipo,
      m.cantidad,
      m.costo_unitario ?? null,
      m.precio_unitario ?? null,
      m.motivo ?? null,
      m.proveedor ?? null,
      m.venta_id ?? null,
      m.creado_en ?? ahora(),
    ],
  );
}

/** Registra movimientos inversos (anulación) para revertir un conjunto de movimientos. */
export async function revertirMovimientos(db: Db, ids: number[], motivo: string) {
  for (const id of ids) {
    const m = await db.get("SELECT producto_id, cantidad, costo_unitario, precio_unitario, venta_id FROM movimientos WHERE id = ?", [id]);
    if (!m) continue;
    await insertMovimiento(db, {
      producto_id: m.producto_id,
      tipo: "anulacion",
      cantidad: -m.cantidad,
      costo_unitario: m.costo_unitario,
      precio_unitario: m.precio_unitario,
      motivo,
      venta_id: m.venta_id,
    });
  }
}

/** UPDATE dinámico de columnas de productos (las llaves vienen de listas fijas, nunca del usuario). */
export async function updateProducto(db: Db, id: number, cambios: Record<string, unknown>) {
  const keys = Object.keys(cambios);
  if (!keys.length) return;
  await db.run(`UPDATE productos SET ${keys.map((k) => `${k} = ?`).join(", ")}, actualizado_en = ? WHERE id = ?`, [
    ...keys.map((k) => cambios[k]),
    ahora(),
    id,
  ]);
}

/** Inserta un producto y le asigna SKU automático (P00001) si no trae. */
export async function insertProducto(db: Db, d: Record<string, any>): Promise<number> {
  const now = ahora();
  const id = await db.insert(
    `INSERT INTO productos (nombre, sku, codigo_barras, categoria, descripcion, precio, costo, unidad, stock_minimo, proveedor, notas, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.nombre,
      d.sku ?? null,
      d.codigo_barras ?? null,
      d.categoria ?? null,
      d.descripcion ?? null,
      round2(d.precio ?? 0),
      round2(d.costo ?? 0),
      d.unidad ?? "pieza",
      d.stock_minimo ?? 0,
      d.proveedor ?? null,
      d.notas ?? null,
      d.creado_en ?? now,
      d.creado_en ?? now,
    ],
  );
  if (!d.sku) await db.run("UPDATE productos SET sku = ? WHERE id = ?", [`P${String(id).padStart(5, "0")}`, id]);
  return id;
}

export const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD");
