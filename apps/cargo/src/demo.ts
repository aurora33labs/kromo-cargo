import type { Db } from "@kromo/core";
import { ahora, insertProducto, round2 } from "./lib.ts";

// [nombre, categoría, precio, costo, stock mínimo, código de barras, proveedor]
const CATALOGO: [string, string, number, number, number, string, string][] = [
  ["Coca-Cola 600 ml", "Bebidas", 20, 13.5, 24, "7501055300075", "FEMSA"],
  ["Coca-Cola 2 L", "Bebidas", 38, 27, 12, "7501055301027", "FEMSA"],
  ["Agua Ciel 1 L", "Bebidas", 13, 7.8, 24, "7501055309221", "FEMSA"],
  ["Jugo Del Valle 1 L", "Bebidas", 27, 18.5, 8, "7501055331093", "FEMSA"],
  ["Cerveza Victoria 355 ml", "Bebidas", 22, 15, 24, "7501064191398", "Modelo"],
  ["Leche Lala entera 1 L", "Lácteos", 29, 23, 12, "7501020515343", "Lala"],
  ["Yogur Danone fresa 1 kg", "Lácteos", 42, 31, 6, "7501032907280", "Danone"],
  ["Queso panela 400 g", "Lácteos", 68, 49, 4, "7501020540093", "Lala"],
  ["Huevo blanco 12 pzas", "Abarrotes", 48, 36, 10, "7502230020015", "Bachoco"],
  ["Arroz Verde Valle 1 kg", "Abarrotes", 34, 24, 8, "7501059224015", "Verde Valle"],
  ["Frijol negro 1 kg", "Abarrotes", 42, 30, 8, "7501059224107", "Verde Valle"],
  ["Aceite Nutrioli 850 ml", "Abarrotes", 52, 39, 6, "7501039120101", "Ragasa"],
  ["Azúcar estándar 1 kg", "Abarrotes", 33, 25, 8, "7501045401010", "Zulka"],
  ["Café Nescafé Clásico 120 g", "Abarrotes", 89, 66, 4, "7501059273754", "Nestlé"],
  ["Atún Dolores en agua 140 g", "Abarrotes", 26, 18, 12, "7501045402017", "Dolores"],
  ["Sopa Maruchan camarón", "Abarrotes", 17, 10.5, 24, "041789002960", "Maruchan"],
  ["Papas Sabritas sal 45 g", "Botanas", 19, 13, 20, "7501011101012", "PepsiCo"],
  ["Doritos nacho 62 g", "Botanas", 21, 14.5, 20, "7501011115026", "PepsiCo"],
  ["Cacahuates Japoneses 100 g", "Botanas", 18, 11, 10, "7501030411109", "Nishikawa"],
  ["Gansito Marinela", "Pan y galletas", 18, 12.5, 15, "7501000111237", "Grupo Bimbo"],
  ["Pan blanco Bimbo grande", "Pan y galletas", 52, 41, 6, "7501000111800", "Grupo Bimbo"],
  ["Galletas Marías Gamesa", "Pan y galletas", 24, 16.5, 10, "7501000664016", "Gamesa"],
  ["Jabón Zote rosa 400 g", "Limpieza", 24, 16, 8, "7501026005688", "La Corona"],
  ["Cloro Cloralex 1 L", "Limpieza", 22, 14.5, 8, "7501025403012", "Alen"],
  ["Papel higiénico Pétalo 4 rollos", "Limpieza", 39, 28, 8, "7501019006142", "Kimberly-Clark"],
  ["Detergente Ariel 1 kg", "Limpieza", 58, 43, 5, "7500435126335", "P&G"],
  ["Pilas AA Duracell 2 pzas", "Varios", 55, 38, 4, "041333415017", "Duracell"], // sin ventas: aparece en "dinero detenido"
  ["Encendedor Bic", "Varios", 15, 8.5, 10, "070330703018", "Bic"],
  ["Cuaderno profesional raya", "Papelería", 45, 28, 5, "7501014561011", "Scribe"], // sin ventas
  ["Pluma Bic azul", "Papelería", 8, 4, 20, "070330717534", "Bic"],
];

const SIN_VENTAS = new Set(["Pilas AA Duracell 2 pzas", "Cuaderno profesional raya"]);

/** Generador pseudoaleatorio con semilla, para que la demo sea reproducible. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

/** Fecha local de hace `diasAtras` días a la hora indicada. */
const fecha = (diasAtras: number, hora: number, min: number) =>
  `${ahora(-diasAtras).slice(0, 10)} ${String(hora).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;

export async function cargarDemo(db: Db, opts: { forzar?: boolean } = {}): Promise<{ productos: number; ventas: number }> {
  const existentes = Number((await db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM productos"))?.n ?? 0);
  if (existentes > 0 && !opts.forzar) {
    throw new Error(`Ya hay ${existentes} productos. Usa --forzar para agregar los datos de demostración de todos modos.`);
  }
  const rand = rng(42);
  const ahoraTxt = ahora();
  let ventas = 0;
  await db.transaction(async (tx) => {
    await tx.run("UPDATE configuracion SET valor = ? WHERE clave = 'nombre_negocio'", ["Abarrotes Doña Lupe"]);
    const ids: { id: number; precio: number; costo: number; minimo: number; popularidad: number; proveedor: string }[] = [];
    const stock = new Map<number, number>();
    for (const [nombre, categoria, precio, costo, minimo, codigo, proveedor] of CATALOGO) {
      const id = await insertProducto(tx, { nombre, categoria, precio, costo, stock_minimo: minimo, codigo_barras: codigo, proveedor, creado_en: fecha(31, 9, 0) });
      ids.push({ id, precio, costo, minimo, proveedor, popularidad: SIN_VENTAS.has(nombre) ? 0 : 0.2 + rand() * 1.3 });
      const inicial = Math.round(minimo * (2 + rand() * 2));
      await tx.run(
        "INSERT INTO movimientos (producto_id, tipo, cantidad, costo_unitario, motivo, creado_en) VALUES (?, 'inicial', ?, ?, 'Inventario inicial', ?)",
        [id, inicial, costo, fecha(30, 9, 0)],
      );
      stock.set(id, inicial);
    }

    for (let dia = 29; dia >= 0; dia--) {
      // Reabasto los lunes y jueves, salvo algunos productos que "se olvidan" para que haya faltantes.
      const dow = new Date(Date.now() - dia * 86400000).getDay();
      if ((dow === 1 || dow === 4) && dia > 2) {
        for (const p of ids) {
          const s = stock.get(p.id)!;
          if (s < p.minimo * 1.5 && rand() > 0.25) {
            const cant = Math.round(p.minimo * (1.5 + rand()));
            await tx.run(
              "INSERT INTO movimientos (producto_id, tipo, cantidad, costo_unitario, proveedor, motivo, creado_en) VALUES (?, 'entrada', ?, ?, ?, 'Entrada de mercancía', ?)",
              [p.id, cant, p.costo, p.proveedor, fecha(dia, 8, 30)],
            );
            stock.set(p.id, s + cant);
          }
        }
      }
      const nVentas = 12 + Math.floor(rand() * 14) + (dow === 6 || dow === 0 ? 8 : 0);
      for (let v = 0; v < nVentas; v++) {
        const when = fecha(dia, 8 + Math.floor(rand() * 13), Math.floor(rand() * 60));
        if (when > ahoraTxt) continue;
        const lineas = new Map<number, number>();
        const nLineas = 1 + Math.floor(rand() * 3);
        for (let l = 0; l < nLineas; l++) {
          const p = ids[Math.floor(Math.pow(rand(), 1.4) * ids.length)]!;
          if (!p.popularidad || rand() > p.popularidad / 1.5) continue;
          if (stock.get(p.id)! - (lineas.get(p.id) ?? 0) >= 1) lineas.set(p.id, (lineas.get(p.id) ?? 0) + 1);
        }
        if (!lineas.size) continue;
        const total = round2([...lineas].reduce((s, [id, c]) => s + c * ids.find((x) => x.id === id)!.precio, 0));
        const metodo = rand() < 0.62 ? "efectivo" : rand() < 0.75 ? "tarjeta" : "transferencia";
        const ventaId = await tx.insert("INSERT INTO ventas (total, metodo_pago, creado_en) VALUES (?, ?, ?)", [total, metodo, when]);
        for (const [id, c] of lineas) {
          const p = ids.find((x) => x.id === id)!;
          await tx.run(
            "INSERT INTO movimientos (producto_id, tipo, cantidad, precio_unitario, costo_unitario, venta_id, creado_en) VALUES (?, 'venta', ?, ?, ?, ?, ?)",
            [id, -c, p.precio, p.costo, ventaId, when],
          );
          stock.set(id, stock.get(id)! - c);
        }
        ventas++;
      }
    }
    await tx.run(
      "INSERT INTO historial (accion, actor_tipo, actor_cliente, actor_usuario, entrada, resumen, creado_en) VALUES ('demo', 'humano', 'cli', 'Sistema', '{}', ?, ?)",
      [`Cargó datos de demostración (${CATALOGO.length} productos, ${ventas} ventas)`, ahoraTxt],
    );
  });
  return { productos: CATALOGO.length, ventas };
}
