import { useState } from "react";
import { money, qty, upload, useData } from "../api.ts";
import { Icon, Modal, StockBadge, Thumb, useAction, useToast, type ProductoLite } from "../components.tsx";
import { useVersion } from "../version.ts";

export function Productos() {
  const version = useVersion();
  const [texto, setTexto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [soloBajo, setSoloBajo] = useState(false);
  const [abierto, setAbierto] = useState<number | "nuevo" | null>(null);
  const { data } = useData<{ productos: ProductoLite[]; total: number }>(
    "buscar_productos",
    { texto, categoria: categoria || undefined, solo_stock_bajo: soloBajo, limite: 500 },
    [version],
  );
  const cats = useData<{ categoria: string; productos: number }[]>("listar_categorias", {}, [version]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Productos</h1>
        <span className="badge num">{data?.total ?? "…"}</span>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setAbierto("nuevo")}>
          <Icon name="plus" /> Nuevo producto
        </button>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Buscar…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <select className="select" style={{ maxWidth: 220 }} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">Todas las categorías</option>
          {cats.data?.filter((c) => c.categoria !== "Sin categoría").map((c) => (
            <option key={c.categoria} value={c.categoria}>
              {c.categoria} ({c.productos})
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={soloBajo} onChange={(e) => setSoloBajo(e.target.checked)} /> Solo stock bajo
        </label>
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th className="r">Precio</th>
              <th className="r">Costo</th>
              <th className="r">Margen</th>
              <th className="r">Stock</th>
            </tr>
          </thead>
          <tbody>
            {data?.productos.map((p) => (
              <tr key={p.id} className="click" onClick={() => setAbierto(p.id)}>
                <td>
                  <div className="pcell">
                    <Thumb foto={p.foto} nombre={p.nombre} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                      <div className="muted mono">{p.sku}{p.codigo_barras ? ` · ${p.codigo_barras}` : ""}</div>
                    </div>
                  </div>
                </td>
                <td>{p.categoria ?? <span className="muted">—</span>}</td>
                <td className="r num">{money(p.precio)}</td>
                <td className="r num muted">{money(p.costo)}</td>
                <td className="r num muted">{p.precio ? `${Math.round(((p.precio - p.costo) / p.precio) * 100)}%` : "—"}</td>
                <td className="r">
                  <StockBadge stock={p.stock} minimo={p.stock_minimo} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.productos.length && <div className="empty">No hay productos. Crea uno o importa tu catálogo.</div>}
      </div>
      {abierto !== null && <ProductoPanel id={abierto === "nuevo" ? null : abierto} onClose={() => setAbierto(null)} onCreated={(id) => setAbierto(id)} />}
    </div>
  );
}

const CAMPOS: { k: string; label: string; tipo?: "num" | "area"; ancho?: 2 }[] = [
  { k: "nombre", label: "Nombre", ancho: 2 },
  { k: "precio", label: "Precio de venta", tipo: "num" },
  { k: "costo", label: "Costo", tipo: "num" },
  { k: "categoria", label: "Categoría" },
  { k: "unidad", label: "Unidad" },
  { k: "codigo_barras", label: "Código de barras" },
  { k: "sku", label: "SKU" },
  { k: "stock_minimo", label: "Stock mínimo", tipo: "num" },
  { k: "proveedor", label: "Proveedor" },
  { k: "descripcion", label: "Descripción", tipo: "area", ancho: 2 },
];

function ProductoPanel({ id, onClose, onCreated }: { id: number | null; onClose: () => void; onCreated: (id: number) => void }) {
  const version = useVersion();
  const run = useAction();
  const toast = useToast();
  const { data: p } = useData<any>(id ? "ver_producto" : "buscar_productos", id ? { producto_id: id } : { limite: 1 }, [version]);
  const prod = id ? p : null;
  const [form, setForm] = useState<Record<string, string>>({});
  const [mov, setMov] = useState<{ tipo: "entrada" | "merma" | "conteo"; cantidad: string; motivo: string; costo: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const val = (k: string) => form[k] ?? (prod?.[k] !== null && prod?.[k] !== undefined ? String(prod[k]) : k === "unidad" && !id ? "pieza" : "");
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const guardar = async () => {
    setGuardando(true);
    const datos: Record<string, any> = {};
    for (const c of CAMPOS) {
      if (form[c.k] === undefined) continue;
      datos[c.k] = c.tipo === "num" ? Number(form[c.k].replace(",", ".")) : form[c.k].trim() || (id ? null : undefined);
      if (datos[c.k] === undefined) delete datos[c.k];
    }
    if (id) {
      if (!Object.keys(datos).length) return setGuardando(false);
      const r = await run("actualizar_producto", { producto_id: id, ...datos }, { exito: () => "Producto actualizado", deshacer: true });
      if (r) setForm({});
    } else {
      if (form.stock_inicial) datos.stock_inicial = Number(form.stock_inicial);
      const r = await run("crear_producto", datos, { exito: (r) => `Creado: ${r.nombre}`, deshacer: true });
      if (r) (setForm({}), onCreated(r.id));
    }
    setGuardando(false);
  };

  const subirFoto = async (file: File) => {
    const up = await upload(file);
    if (!up.ok) return toast({ msg: up.error, kind: "error" });
    await run("actualizar_producto", { producto_id: id, foto_path: up.ruta }, { exito: () => "Foto actualizada" });
  };

  const registrarMov = async () => {
    if (!mov || !id) return;
    const n = Number(mov.cantidad.replace(",", "."));
    let r;
    if (mov.tipo === "entrada") {
      r = await run(
        "registrar_entrada",
        { lineas: [{ producto_id: id, cantidad: n, ...(mov.costo ? { costo_unitario: Number(mov.costo) } : {}) }], nota: mov.motivo || undefined },
        { exito: () => `Entrada de ${qty(n)} registrada`, deshacer: true },
      );
    } else {
      r = await run(
        "ajustar_stock",
        mov.tipo === "merma" ? { producto_id: id, tipo: "merma", cantidad: n, motivo: mov.motivo } : { producto_id: id, tipo: "conteo", stock_real: n, motivo: mov.motivo },
        { exito: (r) => `Stock: ${qty(r.stock_anterior)} → ${qty(r.stock_nuevo)}`, deshacer: true },
      );
    }
    if (r) setMov(null);
  };

  const sucio = Object.keys(form).length > 0;
  return (
    <Modal
      side
      title={id ? prod?.nombre ?? "…" : "Nuevo producto"}
      onClose={onClose}
      footer={
        <>
          {id && prod?.activo && (
            <button
              className="btn danger"
              style={{ marginRight: "auto" }}
              onClick={async () => (await run("actualizar_producto", { producto_id: id, activo: false }, { exito: () => "Producto archivado", deshacer: true })) && onClose()}
            >
              Archivar
            </button>
          )}
          <button className="btn" onClick={onClose}>Cerrar</button>
          <button className="btn primary" disabled={!sucio || guardando || (!id && (!form.nombre || !form.precio))} onClick={guardar}>
            {id ? "Guardar cambios" : "Crear producto"}
          </button>
        </>
      }
    >
      {id && prod && (
        <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
          <label style={{ cursor: "pointer" }} title="Cambiar foto">
            {prod.foto ? (
              <img src={prod.foto} alt="" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 10 }} />
            ) : (
              <div className="thumb" style={{ width: 96, height: 96, borderRadius: 10 }}>
                <span style={{ width: 24, height: 24, display: "inline-flex" }}><Icon name="camera" /></span>
              </div>
            )}
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && subirFoto(e.target.files[0])} />
          </label>
          <div className="stack" style={{ gap: 6, flex: 1 }}>
            <div className="row">
              <StockBadge stock={prod.stock} minimo={prod.stock_minimo} />
              {!prod.activo && <span className="badge">Archivado</span>}
            </div>
            <div className="small muted num">
              Vendidos en 30 días: <b>{qty(prod.ventas_30_dias.unidades)}</b> ({money(prod.ventas_30_dias.importe)})
            </div>
            <div className="row">
              <button className="btn sm" onClick={() => setMov({ tipo: "entrada", cantidad: "", motivo: "", costo: "" })}>+ Entrada</button>
              <button className="btn sm" onClick={() => setMov({ tipo: "merma", cantidad: "", motivo: "", costo: "" })}>Merma</button>
              <button className="btn sm" onClick={() => setMov({ tipo: "conteo", cantidad: String(prod.stock), motivo: "Conteo físico", costo: "" })}>Conteo</button>
            </div>
          </div>
        </div>
      )}

      {mov && (
        <div className="card card-pad stack" style={{ gap: 10, background: "var(--surface-2)" }}>
          <h3>{mov.tipo === "entrada" ? "Registrar entrada" : mov.tipo === "merma" ? "Registrar merma" : "Conteo físico"}</h3>
          <div className="grid2">
            <label className="field">
              <span>{mov.tipo === "conteo" ? "Stock contado" : "Cantidad"}</span>
              <input className="input num" autoFocus inputMode="decimal" value={mov.cantidad} onChange={(e) => setMov({ ...mov, cantidad: e.target.value })} />
            </label>
            {mov.tipo === "entrada" ? (
              <label className="field">
                <span>Costo unitario (opcional)</span>
                <input className="input num" inputMode="decimal" placeholder={String(prod?.costo ?? "")} value={mov.costo} onChange={(e) => setMov({ ...mov, costo: e.target.value })} />
              </label>
            ) : (
              <label className="field">
                <span>Motivo</span>
                <input className="input" value={mov.motivo} placeholder="Caducó, se rompió…" onChange={(e) => setMov({ ...mov, motivo: e.target.value })} />
              </label>
            )}
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn sm" onClick={() => setMov(null)}>Cancelar</button>
            <button className="btn primary sm" disabled={!mov.cantidad || (mov.tipo !== "entrada" && mov.motivo.trim().length < 3)} onClick={registrarMov}>
              Registrar
            </button>
          </div>
        </div>
      )}

      <div className="grid2">
        {CAMPOS.map((c) => (
          <label key={c.k} className="field" style={c.ancho === 2 ? { gridColumn: "1 / -1" } : undefined}>
            <span>{c.label}</span>
            {c.tipo === "area" ? (
              <textarea className="input" rows={2} value={val(c.k)} onChange={(e) => set(c.k, e.target.value)} />
            ) : (
              <input className={`input ${c.tipo === "num" ? "num" : ""}`} inputMode={c.tipo === "num" ? "decimal" : undefined} value={val(c.k)} onChange={(e) => set(c.k, e.target.value)} />
            )}
          </label>
        ))}
        {!id && (
          <label className="field">
            <span>Stock inicial</span>
            <input className="input num" inputMode="decimal" value={form.stock_inicial ?? ""} onChange={(e) => set("stock_inicial", e.target.value)} />
          </label>
        )}
      </div>

      {id && prod?.movimientos?.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 6 }}>Últimos movimientos</h3>
          <table className="table">
            <tbody>
              {prod.movimientos.map((m: any) => (
                <tr key={m.id}>
                  <td><span className={`badge ${m.cantidad > 0 ? "good" : ""}`}>{m.tipo}</span></td>
                  <td className="num r" style={{ fontWeight: 600 }}>{m.cantidad > 0 ? "+" : ""}{qty(m.cantidad)}</td>
                  <td className="small muted">{m.motivo ?? (m.venta_id ? `Venta #${m.venta_id}` : m.proveedor ?? "")}</td>
                  <td className="small muted r">{m.creado_en.slice(5, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
