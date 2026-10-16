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
            <span className="ico"><Icon name="importar" /></span>
            <b>Arrastra tu archivo CSV o Excel (.xlsx)</b>
            <span className="small" id="imp-ayuda">o haz clic (o Enter) para elegirlo. Verás una vista previa antes de aplicar nada.</span>
            <input
              type="file"
              className="file-input"
              accept=".csv,.xlsx,.txt,.tsv"
              aria-label="Elegir archivo CSV o Excel para importar"
              aria-describedby="imp-ayuda"
              onChange={(e) => (e.target.files?.[0] && importar(e.target.files[0]), (e.target.value = ""))}
            />
          </label>
          {resultado && (
            <div className="card card-pad stack tight" role="status">
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
          <div className="card card-pad stack tight">
            <h2>Columnas que reconozco</h2>
            <p className="muted">La primera fila son los encabezados. No importa el orden ni los acentos.</p>
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
                  <tr key={a}><th scope="row" style={{ color: "var(--text)" }}>{a}</th><td className="muted">{b}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card card-pad stack">
          <h2>Exportar catálogo</h2>
          <p className="muted">Con existencias actuales. Útil para un conteo: exporta, cuenta en Excel y vuelve a importar.</p>
          <button className="btn primary" onClick={() => exportar("xlsx")}><Icon name="download" /> Excel (.xlsx)</button>
          <button className="btn" onClick={() => exportar("csv")}><Icon name="download" /> CSV</button>
        </div>
      </div>
    </div>
  );
}
