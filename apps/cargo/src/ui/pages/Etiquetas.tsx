import { useState } from "react";
import { money, useData } from "../api.ts";
import { Field, Icon, Segmented, useAction, type ProductoLite } from "../components.tsx";
import { useVersion } from "../version.ts";

export function Etiquetas() {
  const version = useVersion();
  const run = useAction();
  const [texto, setTexto] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [tipo, setTipo] = useState<"qr" | "barras">("qr");
  const [copias, setCopias] = useState(1);
  const [precio, setPrecio] = useState(true);
  const { data } = useData<{ productos: ProductoLite[] }>("buscar_productos", { texto, limite: 500 }, [version]);

  const toggle = (id: number) => setSel((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  const visibles = data?.productos ?? [];
  const todos = visibles.length > 0 && visibles.every((p) => sel.has(p.id));

  const generar = async (input: Record<string, unknown>) => {
    const r = await run("generar_etiquetas", { tipo, copias, mostrar_precio: precio, ...input }, { exito: (r) => `${r.etiquetas} etiquetas en ${r.paginas} hoja(s)` });
    if (r) window.open(r.url, "_blank");
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Etiquetas</h1>
        <div className="spacer" />
        <p className="hint">Hoja carta, 30 etiquetas de 2⅝" × 1" (tipo Avery 5160)</p>
      </div>
      <div className="cols">
        <div className="card">
          <div className="card-head">
            <label htmlFor="etq-filtro" className="sr-only">Filtrar productos</label>
            <input id="etq-filtro" className="input" type="search" placeholder="Filtrar productos…" value={texto} onChange={(e) => setTexto(e.target.value)} />
          </div>
          <div style={{ maxHeight: "65vh", overflow: "auto" }} tabIndex={0} role="region" aria-label="Productos para etiquetar">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: "2.75rem" }}>
                    <input type="checkbox" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(visibles.map((p) => p.id)))} aria-label="Seleccionar todos" />
                  </th>
                  <th scope="col">Producto</th>
                  <th scope="col">Código</th>
                  <th scope="col" className="r">Precio</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((p) => (
                  <tr key={p.id} className="click" onClick={(e) => (e.target as HTMLElement).tagName !== "INPUT" && toggle(p.id)}>
                    <td><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Seleccionar ${p.nombre}`} /></td>
                    <td>{p.nombre}</td>
                    <td className="mono muted">{p.codigo_barras || p.sku}</td>
                    <td className="r num">{money(p.precio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card card-pad stack">
          <div className="field">
            <span className="field-label" aria-hidden>Tipo de código</span>
            <Segmented label="Tipo de código" value={tipo} options={[["qr", "QR"], ["barras", "Código de barras"]] as const} onChange={setTipo} full />
          </div>
          <Field label="Copias por producto">
            <input className="input num" type="number" min={1} max={100} value={copias} onChange={(e) => setCopias(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
          </Field>
          <label className="check"><input type="checkbox" checked={precio} onChange={(e) => setPrecio(e.target.checked)} /> Mostrar precio</label>
          <p className="muted small">
            El código es el de barras del producto, o su SKU si no tiene. Un lector lo escanea directo en Venta rápida.
          </p>
          <button className="btn primary lg" disabled={!sel.size} onClick={() => generar({ ids: [...sel] })}>
            <Icon name="download" /> {sel.size ? `Generar ${sel.size * copias} etiquetas` : "Elige productos para generar"}
          </button>
          <button className="btn" onClick={() => generar({ solo_entradas_de_hoy: true })}>
            De lo que llegó hoy
          </button>
        </div>
      </div>
    </div>
  );
}
