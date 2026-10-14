import { useState } from "react";
import { upload } from "../api.ts";
import { Icon, useAction, useToast } from "../components.tsx";

export function Importar() {
  const run = useAction();
  const toast = useToast();
  const [over, setOver] = useState(false);
  const [resultado, setResultado] = useState<any>(null);

  const importar = async (file: File) => {
    setResultado(null);
    const up = await upload(file);
    if (!up.ok) return toast({ msg: up.error, kind: "error" });
    const r = await run("importar_productos", { ruta: up.ruta }, { exito: (r) => `Importación lista: ${r.creados} nuevos, ${r.actualizados} actualizados`, deshacer: true });
    if (r) setResultado(r);
  };

  const exportar = async (formato: "csv" | "xlsx") => {
    const r = await run("exportar_productos", { formato });
    if (r) location.href = r.url;
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Importar y exportar</h1>
      </div>
      <div className="cols">
        <div className="stack">
          <label
            className={`dropzone ${over ? "over" : ""}`}
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files[0];
              if (f) importar(f);
            }}
          >
            <div style={{ width: 32, height: 32, margin: "0 auto 8px", color: "var(--accent)" }}><Icon name="importar" /></div>
            <b>Arrastra tu archivo CSV o Excel (.xlsx)</b>
            <div className="muted small">o haz clic para elegirlo. Verás una vista previa antes de aplicar nada.</div>
            <input type="file" accept=".csv,.xlsx,.txt,.tsv" hidden onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />
          </label>
          {resultado && (
            <div className="card card-pad">
              <h2>Resultado</h2>
              <p>
                <b>{resultado.creados}</b> productos nuevos, <b>{resultado.actualizados}</b> actualizados, {resultado.movimientos_de_stock} ajustes de stock.
              </p>
              {resultado.errores.length > 0 && (
                <>
                  <p className="muted">Filas que no se importaron:</p>
                  <ul>
                    {resultado.errores.map((e: any) => (
                      <li key={e.fila}>Fila {e.fila}: {e.error}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <div className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Columnas que reconozco</h2>
            <p className="muted" style={{ margin: 0 }}>La primera fila son los encabezados. No importa el orden ni los acentos.</p>
            <table className="table">
              <tbody>
                {[
                  ["Nombre", "nombre, producto, artículo"],
                  ["Precio", "precio, precio de venta, pv"],
                  ["Costo", "costo, precio de compra"],
                  ["SKU", "sku, clave, código interno"],
                  ["Código de barras", "código, código de barras, ean, upc"],
                  ["Categoría", "categoría, departamento, familia, línea"],
                  ["Existencias", "stock, existencia, inventario, cantidad (en productos existentes se toma como conteo)"],
                  ["Mínimo", "mínimo, stock mínimo"],
                  ["Otros", "unidad, proveedor, descripción, notas"],
                ].map(([a, b]) => (
                  <tr key={a}><td style={{ fontWeight: 600 }}>{a}</td><td className="muted">{b}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card card-pad stack" style={{ gap: 12 }}>
          <h2>Exportar catálogo</h2>
          <p className="muted" style={{ margin: 0 }}>Con existencias actuales. Útil para un conteo: exporta, cuenta en Excel y vuelve a importar.</p>
          <button className="btn primary" onClick={() => exportar("xlsx")}><Icon name="download" /> Excel (.xlsx)</button>
          <button className="btn" onClick={() => exportar("csv")}><Icon name="download" /> CSV</button>
        </div>
      </div>
    </div>
  );
}
