import { useState } from "react";
import { money, qty } from "../api.ts";
import { Icon, ProductPicker, useAction, type ProductoLite } from "../components.tsx";

interface Linea {
  p: ProductoLite;
  cantidad: string;
  costo: string;
}

export function Entradas() {
  const run = useAction();
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [proveedor, setProveedor] = useState("");
  const [nota, setNota] = useState("");
  const [ultima, setUltima] = useState<number[] | null>(null);

  const agregar = (p: ProductoLite) =>
    setLineas((ls) => (ls.some((l) => l.p.id === p.id) ? ls : [...ls, { p, cantidad: "", costo: String(p.costo) }]));
  const upd = (i: number, k: "cantidad" | "costo", v: string) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const validas = lineas.filter((l) => Number(l.cantidad) > 0);
  const total = validas.reduce((s, l) => s + Number(l.cantidad) * (Number(l.costo) || 0), 0);

  const registrar = async () => {
    const r = await run(
      "registrar_entrada",
      {
        lineas: validas.map((l) => ({ producto_id: l.p.id, cantidad: Number(l.cantidad), ...(l.costo !== "" ? { costo_unitario: Number(l.costo) } : {}) })),
        proveedor: proveedor || undefined,
        nota: nota || undefined,
      },
      { exito: (r) => `Entrada registrada: ${r.lineas.length} productos`, deshacer: true },
    );
    if (r) {
      setUltima(validas.map((l) => l.p.id));
      setLineas([]);
      setNota("");
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Entrada de mercancía</h1>
      </div>
      <div className="cols">
        <div className="card">
          <div className="card-head">
            <div style={{ flex: 1 }}>
              <ProductPicker onPick={agregar} autoFocus placeholder="Escanea o busca el producto que llegó…" />
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="r">Stock actual</th>
                <th style={{ width: 110 }}>Cantidad</th>
                <th style={{ width: 120 }}>Costo unit.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={l.p.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{l.p.nombre}</div>
                    <div className="muted mono">{l.p.sku}</div>
                  </td>
                  <td className="r num">{qty(l.p.stock)}</td>
                  <td>
                    <input className="input num" inputMode="decimal" autoFocus value={l.cantidad} onChange={(e) => upd(i, "cantidad", e.target.value)} />
                  </td>
                  <td>
                    <input className="input num" inputMode="decimal" value={l.costo} onChange={(e) => upd(i, "costo", e.target.value)} />
                  </td>
                  <td>
                    <button className="btn ghost sm" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} aria-label="Quitar">
                      <Icon name="x" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!lineas.length && <div className="empty">Agrega los productos que llegaron. El costo se actualiza si cambia.</div>}
        </div>
        <div className="stack">
          <div className="card card-pad stack" style={{ gap: 12 }}>
            <label className="field">
              <span>Proveedor</span>
              <input className="input" value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Opcional" />
            </label>
            <label className="field">
              <span>Nota / factura</span>
              <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" />
            </label>
            <div className="total">
              <span className="muted">{validas.length} productos · {qty(validas.reduce((s, l) => s + Number(l.cantidad), 0))} unidades</span>
              <b className="num">{money(total)}</b>
            </div>
            <button className="btn primary lg" disabled={!validas.length} onClick={registrar}>
              Registrar entrada
            </button>
          </div>
          {ultima && (
            <div className="card card-pad stack" style={{ gap: 10 }}>
              <span>¿Imprimir etiquetas de lo que llegó?</span>
              <button
                className="btn"
                onClick={async () => {
                  const r = await run("generar_etiquetas", { ids: ultima, tipo: "qr" });
                  if (r) window.open(r.url, "_blank");
                }}
              >
                <Icon name="etiquetas" /> Generar etiquetas
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
