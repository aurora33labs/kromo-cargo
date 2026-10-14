// Proceso auxiliar para pruebas de concurrencia: intenta N ventas de 1 pieza en paralelo.
// Uso: bun vender.ts <dataDir> <dbUrl> <productoId> <n> <cliente>
import { createApp } from "../../src/app.ts";

const [dir, url, id, n, cliente] = process.argv.slice(2);
const app = await createApp(dir!, url!);
const res = await Promise.all(
  Array.from({ length: Number(n) }, () =>
    app.registry.execute("registrar_venta", { lineas: [{ producto_id: Number(id), cantidad: 1 }] }, { tipo: "ia", cliente, rol: "dueno" }),
  ),
);
await app.db.close();
console.log(JSON.stringify(res.map((r) => (r.ok ? "ok" : r.error))));
