import { useState } from "react";
import { money, qty } from "../api.ts";
import { EmptyState, Field, Icon, ProductPicker, useAction, type ProductoLite } from "../components.tsx";

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
            <div className="grow">
              <ProductPicker onPick={agregar} autoFocus label="Producto que llegó" placeholder="Escanea o busca el producto que llegó…" />
            </div>
          </div>
          <div className="table-wrap">
          <table className="table" hidden={!lineas.length}>
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col" className="r">Stock actual</th>
                <th scope="col" style={{ width: "7rem" }}>Cantidad</th>
                <th scope="col" style={{ width: "8rem" }}>Costo unit.</th>
                <th scope="col"><span className="sr-only">Quitar</span></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={l.p.id}>
                  <td>
                    <div className="strong">{l.p.nombre}</div>
                    <div className="muted mono">{l.p.sku}</div>
                  </td>
                  <td className="r num">{qty(l.p.stock)}</td>
                  <td>
                    <input className="input num" inputMode="decimal" autoFocus value={l.cantidad} onChange={(e) => upd(i, "cantidad", e.target.value)} aria-label={`Cantidad de ${l.p.nombre}`} />
                  </td>
                  <td>
                    <input className="input num" inputMode="decimal" value={l.costo} onChange={(e) => upd(i, "costo", e.target.value)} aria-label={`Costo unitario de ${l.p.nombre}`} />
                  </td>
                  <td>
                    <button className="btn ghost icon" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} aria-label={`Quitar ${l.p.nombre}`}>
                      <Icon name="x" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {!lineas.length && <EmptyState>Escanea o busca los productos que llegaron. Si el costo cambió, se actualiza.</EmptyState>}
        </div>
        <div className="stack">
          <div className="card card-pad stack">
            <Field label="Proveedor" help="Opcional">
              <input className="input" value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
            </Field>
            <Field label="Nota o factura" help="Opcional">
              <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} />
            </Field>
            <div className="total" aria-live="polite">
              <span className="muted">{validas.length} productos · {qty(validas.reduce((s, l) => s + Number(l.cantidad), 0))} unidades</span>
              <b className="num">{money(total)}</b>
            </div>
            <button className="btn primary lg" disabled={!validas.length} onClick={registrar}>
              Registrar entrada
            </button>
          </div>
          {ultima && (
            <div className="card card-pad stack tight">
              <p>¿Imprimir etiquetas de lo que llegó?</p>
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
