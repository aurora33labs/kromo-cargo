import { ActionError, defineAction, sha256, type Ctx, type Db } from "@kromo/core";
import ExcelJS from "exceljs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { insertMovimiento, insertProducto, revertirMovimientos, round2, updateProducto, type ProductoRow } from "../lib.ts";
import { listarProductos, norm } from "./productos.ts";

// ── Lectura de archivos ──────────────────────────────────────────────

export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

async function leerTabla(ruta: string): Promise<string[][]> {
  if (!existsSync(ruta)) throw new ActionError(`No encuentro el archivo "${ruta}".`);
  const ext = extname(ruta).toLowerCase();
  if (ext === ".csv" || ext === ".txt" || ext === ".tsv") return parseCsv(readFileSync(ruta, "utf8"));
  if (ext === ".xlsx") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(ruta);
    const ws = wb.worksheets[0];
    if (!ws) throw new ActionError("El Excel no tiene hojas.");
    const rows: string[][] = [];
    ws.eachRow((r) => {
      const vals = (r.values as any[]).slice(1).map((v) => {
        if (v === null || v === undefined) return "";
        if (typeof v === "object") return String(v.result ?? v.text ?? v.richText?.map((t: any) => t.text).join("") ?? "");
        return String(v);
      });
      rows.push(vals);
    });
    return rows;
  }
  throw new ActionError(`Formato no soportado (${ext}). Usa CSV o XLSX.`);
}

// ── Mapeo de columnas ────────────────────────────────────────────────

const SINONIMOS: Record<string, string[]> = {
  nombre: ["nombre", "producto", "articulo", "nombre del producto", "name"],
  precio: ["precio", "precio venta", "precio de venta", "pv", "precio publico", "price"],
  costo: ["costo", "precio compra", "precio de compra", "costo unitario", "cost"],
  sku: ["sku", "clave", "codigo interno", "clave interna"],
  codigo_barras: ["codigo de barras", "codigo barras", "codigo", "barcode", "ean", "upc"],
  categoria: ["categoria", "departamento", "familia", "linea", "category"],
  stock: ["stock", "existencia", "existencias", "inventario", "cantidad"],
  stock_minimo: ["minimo", "stock minimo", "existencia minima", "min"],
  unidad: ["unidad", "unidad de medida", "um"],
  proveedor: ["proveedor", "marca"],
  descripcion: ["descripcion", "detalle"],
  notas: ["notas", "observaciones", "comentarios"],
};

function mapearColumnas(encabezados: string[]) {
  const mapa: Record<string, number> = {};
  encabezados.forEach((h, idx) => {
    const n = norm(h).replace(/[_\-.]+/g, " ").trim();
    for (const [campo, sins] of Object.entries(SINONIMOS)) {
      if (mapa[campo] === undefined && sins.includes(n)) mapa[campo] = idx;
    }
  });
  if (mapa.nombre === undefined && mapa.descripcion !== undefined) (mapa.nombre = mapa.descripcion), delete mapa.descripcion;
  return mapa;
}

const numero = (s: string | undefined) => {
  if (s === undefined || s.trim() === "") return undefined;
  const n = Number(s.replace(/[$\s]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

interface Plan {
  fila: number;
  accion: "crear" | "actualizar" | "error";
  error?: string;
  existente?: ProductoRow;
  datos: Record<string, any>;
  stock?: number;
}

async function planear(db: Db, ruta: string, actualizar: boolean) {
  const tabla = await leerTabla(ruta);
  if (tabla.length < 2) throw new ActionError("El archivo no tiene filas de datos (la primera fila debe ser de encabezados).");
  const mapa = mapearColumnas(tabla[0]!);
  if (mapa.nombre === undefined && mapa.sku === undefined && mapa.codigo_barras === undefined) {
    throw new ActionError(
      `No reconozco las columnas. Necesito al menos "nombre" (o sku/código). Encabezados encontrados: ${tabla[0]!.join(", ")}`,
    );
  }
  const productos = await listarProductos(db, true);
  const porSku = new Map(productos.filter((p) => p.sku).map((p) => [norm(p.sku), p]));
  const porCodigo = new Map(productos.filter((p) => p.codigo_barras).map((p) => [p.codigo_barras!, p]));
  const porNombre = new Map(productos.map((p) => [norm(p.nombre), p]));
  const vistos = new Set<string>();

  const planes: Plan[] = tabla.slice(1).map((fila, k) => {
    const get = (c: string) => (mapa[c] === undefined ? undefined : (fila[mapa[c]!] ?? "").trim() || undefined);
    const datos: Record<string, any> = {};
    for (const c of ["nombre", "sku", "codigo_barras", "categoria", "unidad", "proveedor", "descripcion", "notas"]) {
      const v = get(c);
      if (v !== undefined) datos[c] = v;
    }
    for (const c of ["precio", "costo", "stock_minimo"]) {
      const v = numero(get(c));
      if (v !== undefined) datos[c] = v;
    }
    const stock = numero(get("stock"));
    const num = k + 2;
    const bad = Object.entries({ ...datos, stock }).find(([, v]) => typeof v === "number" && (Number.isNaN(v) || v < 0));
    if (bad) return { fila: num, accion: "error", error: `"${bad[0]}" no es un número válido`, datos };
    const clave = norm(datos.sku ?? datos.codigo_barras ?? datos.nombre ?? "");
    if (clave && vistos.has(clave)) return { fila: num, accion: "error", error: "Fila duplicada en el archivo", datos };
    vistos.add(clave);
    const existente =
      (datos.sku && porSku.get(norm(datos.sku))) ||
      (datos.codigo_barras && porCodigo.get(datos.codigo_barras)) ||
      (datos.nombre && porNombre.get(norm(datos.nombre))) ||
      undefined;
    if (existente) {
      if (!actualizar) return { fila: num, accion: "error", error: `Ya existe "${existente.nombre}"`, datos };
      return { fila: num, accion: "actualizar", existente, datos, stock };
    }
    if (!datos.nombre) return { fila: num, accion: "error", error: "Falta el nombre", datos };
    if (datos.precio === undefined) return { fila: num, accion: "error", error: "Falta el precio", datos };
    return { fila: num, accion: "crear", datos, stock };
  });
  return { columnas: Object.keys(mapa), planes };
}

export const importarProductos = defineAction({
  name: "importar_productos",
  title: "Importar productos",
  description:
    "Importa o actualiza productos desde un CSV o Excel (.xlsx). Reconoce columnas comunes (nombre, precio, costo, sku, código, categoría, stock, mínimo…). Siempre muestra vista previa antes de aplicar.",
  kind: "escritura",
  roles: ["dueno"],
  input: z
    .object({
      ruta: z.string().optional().describe("Ruta local del archivo CSV o XLSX"),
      contenido: z.string().max(5_000_000).optional().describe("Alternativa a ruta: el contenido CSV como texto (útil desde una IA remota)"),
      actualizar_existentes: z.boolean().default(true).describe("Si un producto ya existe (por SKU, código o nombre), actualizarlo"),
    })
    .refine((v) => !!v.ruta !== !!v.contenido, "Indica ruta o contenido (solo uno)."),
  confirm: (i, ctx) => vistaPreviaImportacion(ctx.db, archivoDeEntrada(i, ctx), i.actualizar_existentes),
  run: async (i, ctx) => {
    const { db, setUndo, setResumen } = ctx;
    const ruta = archivoDeEntrada(i, ctx);
    const { planes } = await planear(db, ruta, i.actualizar_existentes);
    const creados: number[] = [];
    const actualizados: { id: number; antes: Record<string, unknown> }[] = [];
    const movimientos: number[] = [];
    for (const pl of planes) {
      if (pl.accion === "crear") {
        const id = await insertProducto(db, pl.datos);
        creados.push(id);
        if (pl.stock) movimientos.push(await insertMovimiento(db, { producto_id: id, tipo: "inicial", cantidad: pl.stock, costo_unitario: pl.datos.costo ?? 0, motivo: "Importación" }));
      } else if (pl.accion === "actualizar") {
        const p = pl.existente!;
        const cambios: Record<string, unknown> = Object.fromEntries(Object.entries(pl.datos).filter(([k, v]) => (p as any)[k] !== v));
        if (!Number(p.activo)) cambios.activo = 1;
        if (Object.keys(cambios).length) {
          actualizados.push({ id: p.id, antes: Object.fromEntries(Object.keys(cambios).map((k) => [k, (p as any)[k]])) });
          await updateProducto(db, p.id, cambios);
        }
        if (pl.stock !== undefined && round2(pl.stock - p.stock) !== 0) {
          movimientos.push(await insertMovimiento(db, { producto_id: p.id, tipo: "ajuste", cantidad: round2(pl.stock - p.stock), costo_unitario: p.costo, motivo: "Importación (conteo)" }));
        }
      }
    }
    const errores = planes.filter((p) => p.accion === "error").map((p) => ({ fila: p.fila, error: p.error }));
    setUndo({ creados, actualizados, movimientos });
    setResumen(`Importó ${i.ruta ? basename(ruta) : "datos de la IA"}: ${creados.length} nuevos, ${actualizados.length} actualizados`);
    return { creados: creados.length, actualizados: actualizados.length, movimientos_de_stock: movimientos.length, errores };
  },
  undo: async ({ creados, actualizados, movimientos }, { db }) => {
    await revertirMovimientos(db, movimientos, "Deshacer importación");
    for (const id of creados) await updateProducto(db, id, { activo: 0 });
    for (const a of actualizados) await updateProducto(db, a.id, a.antes);
  },
});

/** Si llega contenido CSV lo guarda (con nombre estable por contenido, para que la confirmación coincida). */
function archivoDeEntrada(i: { ruta?: string; contenido?: string }, ctx: Ctx): string {
  if (i.ruta) return ctx.resolverRuta(i.ruta);
  const dir = join(ctx.dataDir, "subidas", "contenido");
  mkdirSync(dir, { recursive: true });
  const ruta = join(dir, `${sha256(i.contenido!).slice(0, 16)}.csv`);
  if (!existsSync(ruta)) writeFileSync(ruta, i.contenido!);
  return ruta;
}

/** Vista previa de la importación: qué filas se crean, actualizan o tienen errores. */
export async function vistaPreviaImportacion(db: Db, ruta: string, actualizar: boolean) {
  const { columnas, planes } = await planear(db, ruta, actualizar);
  return {
    archivo: basename(ruta),
    filas: planes.length,
    crear: planes.filter((p) => p.accion === "crear").length,
    actualizar: planes.filter((p) => p.accion === "actualizar").length,
    errores: planes.filter((p) => p.accion === "error").map((p) => ({ fila: p.fila, error: p.error })),
    columnas_detectadas: columnas,
    muestra: planes.slice(0, 10).map((p) => ({ fila: p.fila, accion: p.accion, nombre: p.datos.nombre ?? p.existente?.nombre, precio: p.datos.precio, stock: p.stock })),
  };
}

export const exportarProductos = defineAction({
  name: "exportar_productos",
  title: "Exportar productos",
  description: "Exporta el catálogo con stock actual a CSV o Excel. Regresa la ruta del archivo.",
  kind: "accion",
  input: z.object({ formato: z.enum(["csv", "xlsx"]).default("xlsx"), incluir_archivados: z.boolean().default(false) }),
  run: async ({ formato, incluir_archivados }, { db, dataDir, setResumen, urlArchivo }) => {
    const rows = (await listarProductos(db, incluir_archivados)).sort((a, b) => (a.categoria ?? "").localeCompare(b.categoria ?? "") || a.nombre.localeCompare(b.nombre));
    const cols = ["sku", "codigo_barras", "nombre", "categoria", "precio", "costo", "stock", "stock_minimo", "unidad", "proveedor", "descripcion", "notas"] as const;
    const dir = join(dataDir, "exportaciones");
    mkdirSync(dir, { recursive: true });
    const nombre = `productos-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}.${formato}`;
    const ruta = join(dir, nombre);
    if (formato === "csv") {
      const esc = (v: unknown) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(c === "stock" ? round2(r.stock) : (r as any)[c])).join(","))].join("\r\n");
      writeFileSync(ruta, "﻿" + csv); // BOM para que Excel respete los acentos
    } else {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Productos");
      ws.columns = cols.map((c) => ({ header: c, key: c, width: c === "nombre" || c === "descripcion" ? 36 : 14 }));
      ws.getRow(1).font = { bold: true };
      for (const r of rows) ws.addRow({ ...r, stock: round2(r.stock) });
      await wb.xlsx.writeFile(ruta);
    }
    setResumen(`Exportó ${rows.length} productos a ${formato.toUpperCase()}`);
    return { ruta, url: urlArchivo(`/archivos/exportaciones/${nombre}`), productos: rows.length };
  },
});
