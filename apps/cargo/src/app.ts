import { Registry, accionesDeAccesos, openDatabase, type McpOptions } from "@kromo/core";
import { join } from "node:path";
import { generarEtiquetas } from "./actions/etiquetas.ts";
import { exportarProductos, importarProductos } from "./actions/importacion.ts";
import { ajustarStock, registrarEntrada, registrarVenta } from "./actions/movimientos.ts";
import { exportarHistorial, exportarVentas } from "./actions/exportaciones.ts";
import { configurarDominio, configurarNegocio, crearRespaldo, guardarUsuario, listarUsuarios, verConfiguracion } from "./actions/negocio.ts";
import {
  actualizarPreciosMasivo,
  actualizarProducto,
  buscarProductos,
  crearProducto,
  listarCategorias,
  verProducto,
} from "./actions/productos.ts";
import {
  calcularResumen,
  productosSinMovimiento,
  productosStockBajo,
  reporteVentas,
  resumen,
  valorInventario,
} from "./actions/reportes.ts";
import { migraciones } from "./schema.ts";
import pkg from "../package.json" with { type: "json" };

export const APP = "kromo-cargo";
export const VERSION: string = pkg.version;

/**
 * Abre la base y registra las acciones.
 * Base de datos: `dbUrl`, si no `DATABASE_URL` (Postgres, p. ej. en Railway), si no un archivo SQLite en dataDir.
 */
export async function createApp(dataDir: string, dbUrl = process.env.DATABASE_URL || join(dataDir, "cargo.db")) {
  const db = await openDatabase(dbUrl, [migraciones], { backupDir: join(dataDir, "respaldos") });
  const registry = new Registry({ db, dataDir }).register(
    resumen,
    buscarProductos,
    listarCategorias,
    verProducto,
    crearProducto,
    actualizarProducto,
    actualizarPreciosMasivo,
    registrarEntrada,
    registrarVenta,
    ajustarStock,
    productosStockBajo,
    reporteVentas,
    valorInventario,
    productosSinMovimiento,
    generarEtiquetas,
    importarProductos,
    exportarProductos,
    exportarVentas,
    exportarHistorial,
    verConfiguracion,
    configurarNegocio,
    listarUsuarios,
    guardarUsuario,
    configurarDominio,
    crearRespaldo,
    ...accionesDeAccesos,
  );
  return { db, registry, dataDir };
}

export type App = Awaited<ReturnType<typeof createApp>>;

export const MCP_INSTRUCTIONS = `Eres el asistente del inventario de una tienda física. Las herramientas operan la misma base de datos que la app que usa el personal.

Reglas:
- Empieza con "resumen" si no tienes contexto. Usa "buscar_productos" para encontrar ids antes de modificar.
- Nunca se borra nada: para quitar un producto usa actualizar_producto con activo=false.
- El stock solo cambia con registrar_entrada (llegó mercancía), registrar_venta (se vendió) o ajustar_stock (merma, corrección o conteo, siempre con motivo).
- Si una herramienta responde requiere_confirmacion, muestra la vista_previa a la persona en una tabla clara y solo si la aprueba vuelve a llamar con los mismos datos más token_confirmacion.
- Para dar de alta desde fotos: mira cada imagen, propone nombre corto, categoría, descripción y pregunta el precio si no lo sabes; luego llama crear_producto con foto_path.
- Toda acción queda en el historial con tu nombre de cliente; si te equivocas, usa "deshacer" con el historial_id.
- Montos en pesos mexicanos (MXN). Responde en español, breve y con números concretos.`;

export function mcpOptions(app: App): McpOptions {
  return {
    name: APP,
    version: VERSION,
    instructions: MCP_INSTRUCTIONS,
    resources: [
      {
        name: "resumen",
        uri: "cargo://resumen",
        description: "Ventas de hoy y de la semana, valor del inventario y productos por agotarse.",
        read: () => calcularResumen(app.db, app.dataDir),
      },
    ],
  };
}
