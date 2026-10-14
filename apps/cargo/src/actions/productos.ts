import { ActionError, defineAction, type Db } from "@kromo/core";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { z } from "zod";
import {
  PRODUCTO_SELECT,
  ahora,
  getProducto,
  insertMovimiento,
  insertProducto,
  money,
  productoPublico,
  refProducto,
  revertirMovimientos,
  round2,
  updateProducto,
  type ProductoRow,
} from "../lib.ts";

const FOTO_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

/** Normaliza texto para búsquedas: minúsculas y sin acentos. */
export const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function guardarFoto(dataDir: string, origen: string, productoId: number): string {
  if (!existsSync(origen)) throw new ActionError(`No encuentro la foto en "${origen}".`);
  const ext = extname(origen).toLowerCase();
  if (!FOTO_EXT.includes(ext)) throw new ActionError(`Formato de foto no soportado (${ext}). Usa JPG, PNG, WEBP o GIF.`);
  if (statSync(origen).size > 15 * 1024 * 1024) throw new ActionError("La foto pesa más de 15 MB.");
  const dir = join(dataDir, "fotos");
  mkdirSync(dir, { recursive: true });
  const nombre = `${productoId}-${Date.now()}${ext}`;
  copyFileSync(origen, join(dir, nombre));
  return nombre;
}

const camposProducto = {
  nombre: z.string().trim().min(1).max(200).describe("Nombre comercial, claro y corto"),
  precio: z.number().min(0).describe("Precio de venta al público"),
  costo: z.number().min(0).optional().describe("Costo de compra por unidad"),
  sku: z.string().trim().min(1).max(64).optional().describe("Clave interna. Si se omite se genera (P00001)"),
  codigo_barras: z.string().trim().min(1).max(64).optional().describe("Código de barras impreso en el empaque"),
  categoria: z.string().trim().max(80).optional(),
  descripcion: z.string().trim().max(2000).optional(),
  unidad: z.string().trim().max(20).optional().describe("pieza, kg, litro, paquete…"),
  stock_minimo: z.number().min(0).optional().describe("Debajo de este stock se considera bajo"),
  proveedor: z.string().trim().max(120).optional(),
  notas: z.string().trim().max(2000).optional(),
  foto_path: z.string().optional().describe("Ruta local de una foto del producto (JPG/PNG/WEBP)"),
};

/** Productos activos (o todos) con su stock; los filtros finos se hacen en JS para ignorar acentos. */
export const listarProductos = (db: Db, incluirArchivados = false) =>
  db.all<ProductoRow>(`${PRODUCTO_SELECT} ${incluirArchivados ? "" : "WHERE p.activo = 1"} ORDER BY p.nombre`);

export const buscarProductos = defineAction({
  name: "buscar_productos",
  title: "Buscar productos",
  description:
    "Busca productos por texto (nombre, SKU, código, categoría; ignora acentos), categoría o código exacto. Regresa stock actual y si está bajo.",
  kind: "lectura",
  input: z.object({
    texto: z.string().optional().describe("Palabras a buscar"),
    categoria: z.string().optional(),
    codigo: z.string().optional().describe("SKU o código de barras exacto"),
    solo_stock_bajo: z.boolean().default(false),
    incluir_archivados: z.boolean().default(false),
    limite: z.number().int().min(1).max(500).default(50),
  }),
  run: async ({ texto, categoria, codigo, solo_stock_bajo, incluir_archivados, limite }, { db }) => {
    let rows = await listarProductos(db, incluir_archivados);
    if (codigo) {
      const c = norm(codigo.trim());
      rows = rows.filter((p) => norm(p.sku) === c || norm(p.codigo_barras) === c);
    }
    if (categoria) rows = rows.filter((p) => norm(p.categoria) === norm(categoria));
    if (solo_stock_bajo) rows = rows.filter((p) => p.stock <= p.stock_minimo);
    if (texto?.trim()) {
      const palabras = norm(texto).split(/\s+/).filter(Boolean);
      rows = rows
        .map((p) => ({ p, hay: norm([p.nombre, p.sku, p.codigo_barras, p.categoria, p.descripcion].join(" ")) }))
        .filter(({ hay }) => palabras.every((w) => hay.includes(w)))
        .sort((a, b) => Number(norm(b.p.nombre).startsWith(palabras[0]!)) - Number(norm(a.p.nombre).startsWith(palabras[0]!)))
        .map(({ p }) => p);
    }
    return { total: rows.length, productos: rows.slice(0, limite).map(productoPublico) };
  },
});

export const listarCategorias = defineAction({
  name: "listar_categorias",
  title: "Listar categorías",
  description: "Lista las categorías existentes con su número de productos.",
  kind: "lectura",
  input: z.object({}),
  run: async (_i, { db }) =>
    (
      await db.all(
        "SELECT COALESCE(categoria, 'Sin categoría') AS categoria, CAST(COUNT(*) AS INTEGER) AS productos FROM productos WHERE activo = 1 GROUP BY 1 ORDER BY 1",
      )
    ).map((r) => ({ ...r, productos: Number(r.productos) })),
});

export const verProducto = defineAction({
  name: "ver_producto",
  title: "Ver producto",
  description: "Detalle de un producto: datos, stock, últimos movimientos y ventas de los últimos 30 días.",
  kind: "lectura",
  input: z.object({ ...refProducto }),
  run: async (ref, { db }) => {
    const p = await getProducto(db, ref);
    const movimientos = await db.all(
      "SELECT id, tipo, cantidad, costo_unitario, precio_unitario, motivo, proveedor, venta_id, creado_en FROM movimientos WHERE producto_id = ? ORDER BY id DESC LIMIT 20",
      [p.id],
    );
    const v = (await db.get<{ unidades: number; importe: number }>(
      `SELECT COALESCE(-SUM(m.cantidad),0) AS unidades, COALESCE(-SUM(m.cantidad * m.precio_unitario),0) AS importe
       FROM movimientos m WHERE m.producto_id = ? AND m.tipo IN ('venta','anulacion') AND m.venta_id IS NOT NULL AND m.creado_en >= ?`,
      [p.id, ahora(-30)],
    ))!;
    return {
      ...productoPublico(p),
      ventas_30_dias: { unidades: round2(Number(v.unidades)), importe: round2(Number(v.importe)) },
      movimientos,
    };
  },
});

export const crearProducto = defineAction({
  name: "crear_producto",
  title: "Crear producto",
  description:
    "Da de alta un producto nuevo. Si tienes una foto, mírala para proponer nombre, categoría y descripción, y pasa su ruta en foto_path. Puede registrar stock inicial.",
  kind: "escritura",
  input: z.object({
    ...camposProducto,
    stock_inicial: z.number().min(0).optional().describe("Existencias con las que arranca"),
  }),
  run: async (i, { db, dataDir, setUndo, setResumen, resolverRuta }) => {
    const id = await insertProducto(db, i);
    if (i.foto_path) await db.run("UPDATE productos SET foto = ? WHERE id = ?", [guardarFoto(dataDir, resolverRuta(i.foto_path), id), id]);
    const movimientos: number[] = [];
    if (i.stock_inicial) {
      movimientos.push(
        await insertMovimiento(db, { producto_id: id, tipo: "inicial", cantidad: i.stock_inicial, costo_unitario: i.costo ?? 0, motivo: "Stock inicial" }),
      );
    }
    setUndo({ producto_id: id, movimientos });
    setResumen(`Creó el producto "${i.nombre}" (${money(i.precio)})`);
    return productoPublico(await getProducto(db, { producto_id: id }));
  },
  undo: async ({ producto_id, movimientos }, { db }) => {
    await revertirMovimientos(db, movimientos, "Deshacer alta de producto");
    await updateProducto(db, producto_id, { activo: 0 });
  },
});

const EDITABLES = ["nombre", "precio", "costo", "sku", "codigo_barras", "categoria", "descripcion", "unidad", "stock_minimo", "proveedor", "notas", "activo"] as const;

export const actualizarProducto = defineAction({
  name: "actualizar_producto",
  title: "Actualizar producto",
  description:
    "Cambia datos de un producto (nombre, precio, costo, categoría, foto…). Para archivarlo usa activo=false; nunca se borra. No cambia el stock: para eso usa registrar_entrada o ajustar_stock.",
  kind: "escritura",
  input: z.object({
    producto_id: z.number().int(),
    ...z.object(camposProducto).partial().shape,
    sku: z.string().trim().max(64).nullable().optional(),
    codigo_barras: z.string().trim().max(64).nullable().optional(),
    activo: z.boolean().optional().describe("false para archivar el producto"),
  }),
  run: async (i, { db, dataDir, setUndo, setResumen, resolverRuta }) => {
    const antes = await getProducto(db, { producto_id: i.producto_id });
    const cambios: Record<string, unknown> = {};
    for (const k of EDITABLES) {
      const v = (i as any)[k];
      if (v === undefined) continue;
      const nuevo = k === "activo" ? (v ? 1 : 0) : k === "precio" || k === "costo" ? round2(v) : v === "" ? null : v;
      const previo = k === "activo" ? Number(antes.activo) : (antes as any)[k];
      if (nuevo !== previo) cambios[k] = nuevo;
    }
    if (i.foto_path) cambios.foto = guardarFoto(dataDir, resolverRuta(i.foto_path), i.producto_id);
    if (Object.keys(cambios).length === 0) return { sin_cambios: true, producto: productoPublico(antes) };
    await updateProducto(db, i.producto_id, cambios);
    setUndo({ producto_id: i.producto_id, antes: Object.fromEntries(Object.keys(cambios).map((k) => [k, (antes as any)[k]])) });
    const detalle = Object.keys(cambios)
      .map((k) => (k === "precio" ? `precio ${money(antes.precio)} → ${money(cambios.precio as number)}` : k))
      .join(", ");
    setResumen(`Actualizó "${antes.nombre}": ${detalle}`);
    return { producto: productoPublico(await getProducto(db, { producto_id: i.producto_id })) };
  },
  undo: ({ producto_id, antes }, { db }) => updateProducto(db, producto_id, antes),
});

const masivoInput = z
  .object({
    categoria: z.string().optional().describe("Solo productos de esta categoría"),
    ids: z.array(z.number().int()).optional().describe("Solo estos productos"),
    texto: z.string().optional().describe("Solo productos cuyo nombre contenga este texto"),
    todos: z.boolean().default(false).describe("true para aplicar a todo el catálogo (sin filtro)"),
    porcentaje: z.number().min(-90).max(500).optional().describe("Cambio porcentual: 10 sube 10%, -5 baja 5%"),
    monto: z.number().optional().describe("Cambio fijo en pesos: 2 suma $2, -1 resta $1"),
    campo: z.enum(["precio", "costo"]).default("precio"),
    redondeo: z.enum(["ninguno", "peso", "cincuenta_centavos"]).default("ninguno"),
  })
  .refine((v) => (v.porcentaje === undefined) !== (v.monto === undefined), "Indica porcentaje o monto (solo uno).")
  .refine((v) => v.todos || v.categoria || v.ids?.length || v.texto, "Indica un filtro (categoría, ids, texto) o todos=true.");

async function calcularMasivo(db: Db, i: z.output<typeof masivoInput>) {
  let rows = await listarProductos(db);
  if (i.categoria) rows = rows.filter((p) => norm(p.categoria) === norm(i.categoria));
  if (i.ids?.length) rows = rows.filter((p) => i.ids!.includes(p.id));
  if (i.texto) rows = rows.filter((p) => norm(p.nombre).includes(norm(i.texto)));
  const redondear = (n: number) =>
    i.redondeo === "peso" ? Math.round(n) : i.redondeo === "cincuenta_centavos" ? Math.round(n * 2) / 2 : round2(n);
  return rows.map((p) => {
    const antes = p[i.campo];
    const despues = Math.max(0, redondear(i.porcentaje !== undefined ? antes * (1 + i.porcentaje / 100) : antes + i.monto!));
    return { id: p.id, nombre: p.nombre, antes, despues };
  });
}

export const actualizarPreciosMasivo = defineAction({
  name: "actualizar_precios_masivo",
  title: "Actualizar precios en lote",
  description:
    "Sube o baja precios (o costos) de varios productos a la vez por porcentaje o monto fijo, filtrando por categoría, ids o texto. Siempre pide confirmación con vista previa.",
  kind: "escritura",
  roles: ["dueno"],
  input: masivoInput,
  confirm: async (i, { db }) => {
    const cambios = await calcularMasivo(db, i);
    if (!cambios.length) throw new ActionError("Ningún producto coincide con el filtro.");
    return { campo: i.campo, productos_afectados: cambios.length, cambios: cambios.slice(0, 100) };
  },
  run: async (i, { db, setUndo, setResumen }) => {
    const cambios = await calcularMasivo(db, i);
    for (const c of cambios) await updateProducto(db, c.id, { [i.campo]: c.despues });
    setUndo({ campo: i.campo, cambios: cambios.map((c) => ({ id: c.id, antes: c.antes })) });
    const desc = i.porcentaje !== undefined ? `${i.porcentaje > 0 ? "+" : ""}${i.porcentaje}%` : `${i.monto! > 0 ? "+" : ""}${money(i.monto!)}`;
    setResumen(`Cambió ${i.campo} de ${cambios.length} productos (${desc})`);
    return { actualizados: cambios.length, cambios };
  },
  undo: async ({ campo, cambios }, { db }) => {
    for (const c of cambios) await updateProducto(db, c.id, { [campo === "costo" ? "costo" : "precio"]: c.antes });
  },
});
