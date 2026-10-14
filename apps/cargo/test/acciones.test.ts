import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Actor } from "@kromo/core";
import type { App } from "../src/app.ts";
import { testApp } from "./helpers.ts";

const humano: Actor = { tipo: "humano", cliente: "ui", usuario: "Ana", rol: "dueno" };
const ia: Actor = { tipo: "ia", cliente: "claude-code", rol: "dueno" };
const empleado: Actor = { tipo: "humano", cliente: "ui", usuario: "Luis", rol: "empleado" };

let app: App;
let dir: string;
let cleanup: () => Promise<void>;

async function ok(name: string, input: unknown, actor: Actor = humano): Promise<any> {
  const res = await app.registry.execute(name, input, actor);
  if (!res.ok) throw new Error(`${name}: ${res.error}`);
  return res;
}

async function crear(nombre: string, extra: Record<string, unknown> = {}) {
  const r = await ok("crear_producto", { nombre, precio: 20, costo: 12, stock_inicial: 10, ...extra });
  return r.resultado as { id: number; sku: string; stock: number };
}

async function stock(id: number): Promise<number> {
  return (await ok("ver_producto", { producto_id: id })).resultado.stock;
}

beforeEach(async () => {
  ({ app, dir, cleanup } = await testApp());
});
afterEach(() => cleanup());

describe("productos", () => {
  test("crear genera SKU, registra stock inicial y queda en el historial", async () => {
    const r = await ok("crear_producto", { nombre: "Coca-Cola 600ml", precio: 18, costo: 11, stock_inicial: 24, categoria: "Bebidas" });
    expect(r.resultado.sku).toBe("P00001");
    expect(r.resultado.stock).toBe(24);
    expect(r.historial_id).toBeGreaterThan(0);
  });

  test("búsqueda ignora acentos y mayúsculas", async () => {
    await crear("Café de olla");
    await crear("Azúcar morena");
    const r = await ok("buscar_productos", { texto: "CAFE" });
    expect(r.resultado.productos.map((p: any) => p.nombre)).toEqual(["Café de olla"]);
  });

  test("SKU duplicado da un error claro", async () => {
    await crear("A", { sku: "X1" });
    const res = await app.registry.execute("crear_producto", { nombre: "B", precio: 1, sku: "X1" }, humano);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("sku");
  });

  test("validación en español", async () => {
    const res = await app.registry.execute("crear_producto", { nombre: "", precio: -1 }, humano);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Datos inválidos/);
  });

  test("actualizar y deshacer restaura el valor anterior", async () => {
    const p = await crear("Pan");
    const r = await ok("actualizar_producto", { producto_id: p.id, precio: 25 });
    expect(r.resultado.producto.precio).toBe(25);
    await ok("deshacer", { historial_id: r.historial_id });
    expect((await ok("ver_producto", { producto_id: p.id })).resultado.precio).toBe(20);
  });
});

describe("movimientos y ventas", () => {
  test("el stock es la suma del libro de movimientos", async () => {
    const p = await crear("Galletas");
    await ok("registrar_entrada", { lineas: [{ producto_id: p.id, cantidad: 5, costo_unitario: 13 }], proveedor: "Gamesa" });
    await ok("registrar_venta", { lineas: [{ producto_id: p.id, cantidad: 3 }] });
    expect(await stock(p.id)).toBe(12);
    const prod = (await ok("ver_producto", { producto_id: p.id })).resultado;
    expect(prod.costo).toBe(13);
  });

  test("venta por código, líneas repetidas se juntan y calcula cambio", async () => {
    const p = await crear("Chicles", { codigo_barras: "750100" });
    const r = await ok("registrar_venta", {
      lineas: [{ codigo: "750100", cantidad: 2 }, { producto_id: p.id, cantidad: 1 }],
      metodo_pago: "efectivo",
      pago_con: 100,
    });
    expect(r.resultado.total).toBe(60);
    expect(r.resultado.cambio).toBe(40);
    expect(r.resultado.lineas).toHaveLength(1);
    expect(await stock(p.id)).toBe(7);
  });

  test("no permite vender más de lo que hay", async () => {
    const p = await crear("Leche", { stock_inicial: 2 });
    const res = await app.registry.execute("registrar_venta", { lineas: [{ producto_id: p.id, cantidad: 3 }] }, humano);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Stock insuficiente");
    expect(await stock(p.id)).toBe(2);
  });

  test("deshacer una venta la anula y regresa el stock sin borrar nada", async () => {
    const p = await crear("Jabón");
    const v = await ok("registrar_venta", { lineas: [{ producto_id: p.id, cantidad: 4 }] });
    expect(await stock(p.id)).toBe(6);
    await ok("deshacer", { historial_id: v.historial_id }, ia);
    expect(await stock(p.id)).toBe(10);
    const rep = (await ok("reporte_ventas", {})).resultado;
    expect(rep.totales.ventas).toBe(0);
    const movs = (await ok("ver_producto", { producto_id: p.id })).resultado.movimientos;
    expect(movs.map((m: any) => m.tipo)).toEqual(["anulacion", "venta", "inicial"]);
    const again = await app.registry.execute("deshacer", { historial_id: v.historial_id }, humano);
    expect(again.ok).toBe(false);
  });

  test("conteo físico ajusta a la cantidad real", async () => {
    const p = await crear("Arroz");
    const r = await ok("ajustar_stock", { producto_id: p.id, tipo: "conteo", stock_real: 7, motivo: "Conteo semanal" });
    expect(r.resultado.cambio).toBe(-3);
    expect(await stock(p.id)).toBe(7);
  });
});

describe("confirmación en dos pasos", () => {
  test("precios masivos: vista previa, token y ejecución", async () => {
    await crear("Agua 1L", { categoria: "Bebidas", precio: 10 });
    await crear("Refresco", { categoria: "Bebidas", precio: 20 });
    await crear("Pan", { categoria: "Panadería", precio: 5 });
    const input = { categoria: "bebidas", porcentaje: 10, redondeo: "peso" };
    const paso1 = (await ok("actualizar_precios_masivo", input, ia)) as any;
    expect(paso1.requiere_confirmacion).toBe(true);
    expect(paso1.vista_previa.productos_afectados).toBe(2);
    expect(paso1.vista_previa.cambios.map((c: any) => c.despues)).toEqual([11, 22]);

    // Un token no sirve para otros datos.
    const otro = (await ok("actualizar_precios_masivo", { ...input, porcentaje: 50, token_confirmacion: paso1.token_confirmacion }, ia)) as any;
    expect(otro.requiere_confirmacion).toBe(true);

    const paso2 = await ok("actualizar_precios_masivo", { ...input, token_confirmacion: paso1.token_confirmacion }, ia);
    expect(paso2.resultado.actualizados).toBe(2);
    // El token es de un solo uso.
    const reuse = (await ok("actualizar_precios_masivo", { ...input, token_confirmacion: paso1.token_confirmacion }, ia)) as any;
    expect(reuse.requiere_confirmacion).toBe(true);

    await ok("deshacer", { historial_id: paso2.historial_id });
    const r = (await ok("buscar_productos", { categoria: "Bebidas" })).resultado.productos;
    expect(r.map((p: any) => p.precio).sort()).toEqual([10, 20]);
  });

  test("ajustes chicos no piden confirmación, los grandes sí", async () => {
    const p = await crear("Huevo", { stock_inicial: 100 });
    const chico = await ok("ajustar_stock", { producto_id: p.id, tipo: "merma", cantidad: 2, motivo: "Se rompieron" });
    expect(chico.resultado.stock_nuevo).toBe(98);
    const grande = (await ok("ajustar_stock", { producto_id: p.id, tipo: "merma", cantidad: 30, motivo: "Caducó lote" })) as any;
    expect(grande.requiere_confirmacion).toBe(true);
    expect(await stock(p.id)).toBe(98);
  });
});

describe("permisos e historial", () => {
  test("un empleado no puede cambiar precios en lote ni deshacer", async () => {
    await crear("X", { categoria: "A" });
    const r = await app.registry.execute("actualizar_precios_masivo", { categoria: "A", porcentaje: 5 }, empleado);
    expect(r.ok).toBe(false);
    const d = await app.registry.execute("deshacer", { historial_id: 1 }, empleado);
    expect(d.ok).toBe(false);
  });

  test("el historial distingue acciones de IA", async () => {
    await crear("Uno");
    await ok("crear_producto", { nombre: "Dos", precio: 1 }, ia);
    const h = (await ok("historial", { solo_ia: true })).resultado;
    expect(h).toHaveLength(1);
    expect(h[0].actor_cliente).toBe("claude-code");
    expect(h[0].resumen).toContain("Dos");
  });
});

describe("reportes", () => {
  test("stock bajo, valor de inventario y reporte de ventas", async () => {
    const a = await crear("Tortillas", { stock_inicial: 3, stock_minimo: 5, precio: 22, costo: 15 });
    await crear("Sal", { stock_inicial: 50, stock_minimo: 5, precio: 10, costo: 6 });
    await ok("registrar_venta", { lineas: [{ producto_id: a.id, cantidad: 1 }], metodo_pago: "tarjeta" });
    const bajo = (await ok("productos_stock_bajo", {})).resultado;
    expect(bajo.productos.map((p: any) => p.nombre)).toEqual(["Tortillas"]);
    expect(bajo.productos[0].sugerido_pedir).toBeGreaterThan(0);
    const valor = (await ok("valor_inventario", {})).resultado;
    expect(valor.total_costo).toBe(2 * 15 + 50 * 6);
    const rep = (await ok("reporte_ventas", { agrupar: "metodo_pago" })).resultado;
    expect(rep.totales.importe).toBe(22);
    expect(rep.totales.utilidad_bruta_estimada).toBe(7);
    expect(rep.filas[0].grupo).toBe("tarjeta");
    const res = (await ok("resumen", {})).resultado;
    expect(res.ventas_hoy.importe).toBe(22);
  });
});

describe("importar y exportar", () => {
  test("importa CSV con encabezados comunes, vista previa y deshacer", async () => {
    await crear("Frijol", { sku: "FRI-1", stock_inicial: 5 });
    const csv = join(dir, "inv.csv");
    writeFileSync(
      csv,
      "Clave;Producto;Precio de venta;Costo;Existencia;Departamento\n" +
        'FRI-1;Frijol negro;"$32,50";20;12;Abarrotes\n' +
        "ACE-1;Aceite 1L;45;30;8;Abarrotes\n" +
        ";Sin precio;;;;\n",
    );
    const paso1 = (await ok("importar_productos", { ruta: csv })) as any;
    expect(paso1.requiere_confirmacion).toBe(true);
    expect(paso1.vista_previa).toMatchObject({ crear: 1, actualizar: 1 });
    expect(paso1.vista_previa.errores).toHaveLength(1);
    const paso2 = await ok("importar_productos", { ruta: csv, token_confirmacion: paso1.token_confirmacion });
    expect(paso2.resultado).toMatchObject({ creados: 1, actualizados: 1 });
    const fri = (await ok("ver_producto", { codigo: "FRI-1" })).resultado;
    expect(fri).toMatchObject({ nombre: "Frijol negro", precio: 32.5, stock: 12 });

    await ok("deshacer", { historial_id: paso2.historial_id });
    const fri2 = (await ok("ver_producto", { codigo: "FRI-1" })).resultado;
    expect(fri2).toMatchObject({ nombre: "Frijol", stock: 5 });
    expect((await ok("buscar_productos", { texto: "aceite" })).resultado.total).toBe(0);
  });

  test("exporta a XLSX y se puede volver a importar", async () => {
    await crear("Atún", { categoria: "Enlatados" });
    const exp = await ok("exportar_productos", { formato: "xlsx" });
    expect(exp.resultado.productos).toBe(1);
    const prev = (await ok("importar_productos", { ruta: exp.resultado.ruta })) as any;
    expect(prev.vista_previa).toMatchObject({ crear: 0, actualizar: 1 });
  });

  test("genera PDF de etiquetas", async () => {
    await crear("Etiqueta ñandú «especial»");
    const r = await ok("generar_etiquetas", { tipo: "qr", copias: 2 });
    expect(r.resultado.etiquetas).toBe(2);
    expect(await Bun.file(r.resultado.ruta).exists()).toBe(true);
    const b = await ok("generar_etiquetas", { tipo: "barras" });
    expect(b.resultado.paginas).toBe(1);
  });
});
