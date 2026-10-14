import { ActionError, defineAction, type Db } from "@kromo/core";
import { z } from "zod";
import { ahora, getProducto, insertMovimiento, money, refProducto, revertirMovimientos, round2, updateProducto, type ProductoRow } from "../lib.ts";

const linea = (extra: Record<string, z.ZodType>) =>
  z.object({ ...refProducto, cantidad: z.number().positive().describe("Unidades (siempre positivo)"), ...extra });

export const registrarEntrada = defineAction({
  name: "registrar_entrada",
  title: "Registrar entrada",
  description:
    "Registra mercancía que llegó (compra a proveedor): suma stock de una o varias líneas y, si se indica costo, actualiza el costo del producto.",
  kind: "escritura",
  input: z.object({
    lineas: z.array(linea({ costo_unitario: z.number().min(0).optional().describe("Costo por unidad de esta compra") })).min(1),
    proveedor: z.string().trim().max(120).optional(),
    nota: z.string().trim().max(500).optional(),
    actualizar_costo: z.boolean().default(true).describe("Actualizar el costo del producto con el de esta compra"),
  }),
  run: async (i, { db, setUndo, setResumen }) => {
    const movimientos: number[] = [];
    const costosAntes: { id: number; costo: number }[] = [];
    const detalle = [];
    for (const l of i.lineas as any[]) {
      const p = await getProducto(db, l);
      const costo = l.costo_unitario ?? p.costo;
      movimientos.push(
        await insertMovimiento(db, {
          producto_id: p.id,
          tipo: "entrada",
          cantidad: l.cantidad,
          costo_unitario: costo,
          proveedor: i.proveedor,
          motivo: i.nota ?? "Entrada de mercancía",
        }),
      );
      if (i.actualizar_costo && l.costo_unitario !== undefined && l.costo_unitario !== p.costo) {
        costosAntes.push({ id: p.id, costo: p.costo });
        await updateProducto(db, p.id, { costo: round2(l.costo_unitario) });
      }
      detalle.push({ producto_id: p.id, nombre: p.nombre, cantidad: l.cantidad, stock_nuevo: round2(p.stock + l.cantidad) });
    }
    const unidades = detalle.reduce((s, d) => s + d.cantidad, 0);
    setUndo({ movimientos, costosAntes });
    setResumen(`Entrada de ${unidades} unidades (${detalle.length} productos)${i.proveedor ? ` de ${i.proveedor}` : ""}`);
    return { lineas: detalle };
  },
  undo: async ({ movimientos, costosAntes }, { db }) => {
    await revertirMovimientos(db, movimientos, "Deshacer entrada");
    for (const c of costosAntes) await updateProducto(db, c.id, { costo: c.costo });
  },
});

export const registrarVenta = defineAction({
  name: "registrar_venta",
  title: "Registrar venta",
  description:
    "Registra una venta de mostrador: descuenta stock y guarda el total y el método de pago. Falla si no hay stock suficiente, salvo permitir_sin_stock=true.",
  kind: "escritura",
  input: z.object({
    lineas: z.array(linea({ precio_unitario: z.number().min(0).optional().describe("Precio cobrado; por defecto el del producto") })).min(1),
    metodo_pago: z.enum(["efectivo", "tarjeta", "transferencia", "otro"]).default("efectivo"),
    pago_con: z.number().min(0).optional().describe("Con cuánto pagó el cliente (para calcular el cambio)"),
    nota: z.string().trim().max(500).optional(),
    permitir_sin_stock: z.boolean().default(false),
  }),
  run: async (i, { db, setUndo, setResumen }) => {
    // Junta líneas repetidas del mismo producto y precio.
    const agrupadas = new Map<string, { p: ProductoRow; cantidad: number; precio: number }>();
    for (const l of i.lineas as any[]) {
      const p = await getProducto(db, l);
      if (!Number(p.activo)) throw new ActionError(`"${p.nombre}" está archivado.`);
      const precio = l.precio_unitario ?? p.precio;
      const key = `${p.id}:${precio}`;
      const prev = agrupadas.get(key);
      if (prev) prev.cantidad += l.cantidad;
      else agrupadas.set(key, { p, cantidad: l.cantidad, precio });
    }
    if (!i.permitir_sin_stock) {
      const pedidos = new Map<number, { p: ProductoRow; cantidad: number }>();
      for (const { p, cantidad } of agrupadas.values()) {
        const prev = pedidos.get(p.id);
        if (prev) prev.cantidad += cantidad;
        else pedidos.set(p.id, { p, cantidad });
      }
      const faltantes = [...pedidos.values()]
        .filter(({ p, cantidad }) => cantidad > p.stock)
        .map(({ p, cantidad }) => `${p.nombre} (hay ${round2(p.stock)}, se piden ${cantidad})`);
      if (faltantes.length) throw new ActionError(`Stock insuficiente: ${faltantes.join("; ")}.`, { faltantes });
    }
    const total = round2([...agrupadas.values()].reduce((s, l) => s + l.cantidad * l.precio, 0));
    if (i.pago_con !== undefined && i.pago_con < total) throw new ActionError(`El pago (${money(i.pago_con)}) no cubre el total (${money(total)}).`);
    const venta_id = await db.insert("INSERT INTO ventas (total, metodo_pago, nota, creado_en) VALUES (?, ?, ?, ?)", [
      total,
      i.metodo_pago,
      i.nota ?? null,
      ahora(),
    ]);
    const movimientos: number[] = [];
    const lineas = [];
    for (const { p, cantidad, precio } of agrupadas.values()) {
      movimientos.push(
        await insertMovimiento(db, { producto_id: p.id, tipo: "venta", cantidad: -cantidad, precio_unitario: precio, costo_unitario: p.costo, venta_id }),
      );
      lineas.push({ producto_id: p.id, nombre: p.nombre, cantidad, precio_unitario: precio, importe: round2(cantidad * precio) });
    }
    setUndo({ venta_id, movimientos });
    setResumen(`Venta #${venta_id} por ${money(total)} (${i.metodo_pago})`);
    return {
      venta_id,
      total,
      metodo_pago: i.metodo_pago,
      lineas,
      ...(i.pago_con !== undefined ? { pago_con: i.pago_con, cambio: round2(i.pago_con - total) } : {}),
    };
  },
  undo: async ({ venta_id, movimientos }, { db }) => {
    await db.run("UPDATE ventas SET anulada = 1 WHERE id = ?", [venta_id]);
    await revertirMovimientos(db, movimientos, `Anulación de venta #${venta_id}`);
  },
});

const ajusteInput = z
  .object({
    ...refProducto,
    tipo: z
      .enum(["merma", "ajuste", "conteo"])
      .describe("merma: se perdió o caducó (cantidad positiva que se resta). ajuste: corrección con signo. conteo: indica el stock real contado."),
    cantidad: z.number().optional().describe("Para merma (positiva) o ajuste (con signo)"),
    stock_real: z.number().min(0).optional().describe("Para conteo: existencias contadas físicamente"),
    motivo: z.string().trim().min(3).max(300).describe("Por qué se ajusta (obligatorio)"),
  })
  .refine((v) => (v.tipo === "conteo" ? v.stock_real !== undefined : v.cantidad !== undefined), "Falta cantidad (o stock_real para conteo).");

async function calcularAjuste(db: Db, i: z.output<typeof ajusteInput>) {
  const p = await getProducto(db, i);
  const delta = round2(i.tipo === "conteo" ? i.stock_real! - p.stock : i.tipo === "merma" ? -Math.abs(i.cantidad!) : i.cantidad!);
  if (delta === 0) throw new ActionError(`El stock de "${p.nombre}" ya es ${round2(p.stock)}; no hay nada que ajustar.`);
  return { p, delta };
}

export const ajustarStock = defineAction({
  name: "ajustar_stock",
  title: "Ajustar stock",
  description:
    "Corrige existencias por merma, ajuste o conteo físico, siempre con motivo. Los ajustes grandes (≥20 unidades o ≥$1,000) piden confirmación.",
  kind: "escritura",
  input: ajusteInput,
  confirm: async (i, { db }) => {
    const { p, delta } = await calcularAjuste(db, i);
    if (Math.abs(delta) < 20 && Math.abs(delta * p.costo) < 1000) return null;
    return {
      producto: p.nombre,
      stock_actual: round2(p.stock),
      cambio: delta,
      stock_nuevo: round2(p.stock + delta),
      valor_al_costo: money(round2(delta * p.costo)),
      motivo: i.motivo,
    };
  },
  run: async (i, { db, setUndo, setResumen }) => {
    const { p, delta } = await calcularAjuste(db, i);
    const id = await insertMovimiento(db, {
      producto_id: p.id,
      tipo: i.tipo === "merma" ? "merma" : "ajuste",
      cantidad: delta,
      costo_unitario: p.costo,
      motivo: i.motivo,
    });
    setUndo({ movimientos: [id] });
    setResumen(`${i.tipo === "merma" ? "Merma" : "Ajuste"} de ${delta > 0 ? "+" : ""}${delta} en "${p.nombre}": ${i.motivo}`);
    return { producto_id: p.id, nombre: p.nombre, stock_anterior: round2(p.stock), cambio: delta, stock_nuevo: round2(p.stock + delta) };
  },
  undo: ({ movimientos }, { db }) => revertirMovimientos(db, movimientos, "Deshacer ajuste"),
});
