import { useEffect, useRef, useState } from "react";
import { get, money, qty, useData } from "../api.ts";
import { Icon, StockBadge, useAction, useToast, type ProductoLite } from "../components.tsx";
import { useVersion } from "../version.ts";

interface Linea {
  p: ProductoLite;
  cantidad: number;
}

const METODOS = [
  ["efectivo", "Efectivo"],
  ["tarjeta", "Tarjeta"],
  ["transferencia", "Transferencia"],
] as const;

export function Venta() {
  const version = useVersion();
  const run = useAction();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [metodo, setMetodo] = useState<(typeof METODOS)[number][0]>("efectivo");
  const [pagoCon, setPagoCon] = useState("");
  const [cobrando, setCobrando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(q), 120);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useData<{ productos: ProductoLite[]; total: number }>("buscar_productos", { texto: busqueda, limite: 24 }, [version]);

  const agregar = (p: ProductoLite, cantidad = 1) => {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.p.id === p.id);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, cantidad: l.cantidad + cantidad } : l));
      return [...ls, { p, cantidad }];
    });
    input.current?.focus();
  };

  // Un lector de códigos teclea "código + Enter" muy rápido y puede mandar el siguiente escaneo
  // antes de que responda la búsqueda anterior: el texto se toma y se limpia al presionar Enter.
  const onEnter = async (texto: string) => {
    texto = texto.trim();
    if (!texto) return;
    setQ("");
    // "3*7501055300075" agrega 3 piezas (como en las cajas registradoras).
    const m = texto.match(/^(\d+(?:\.\d+)?)\s*[*x]\s*(.+)$/i);
    const cant = m ? Number(m[1]) : 1;
    const codigo = m ? m[2]!.trim() : texto;
    const exacto = await get("buscar_productos", { codigo, limite: 1 }).catch(() => null);
    if (exacto?.productos?.[0]) return agregar(exacto.productos[0], cant);
    const porTexto = await get("buscar_productos", { texto: codigo, limite: 2 }).catch(() => null);
    if (porTexto?.productos?.length === 1) return agregar(porTexto.productos[0], cant);
    setQ(texto); // no se encontró: deja el texto para corregirlo
    toast({ msg: `No encontré "${codigo}". Elige de la lista.`, kind: "error" });
  };

  const total = lineas.reduce((s, l) => s + l.cantidad * l.p.precio, 0);
  const pago = Number(pagoCon) || 0;
  const cambio = pago - total;

  const cobrar = async () => {
    if (!lineas.length || cobrando) return;
    setCobrando(true);
    const r = await run(
      "registrar_venta",
      {
        lineas: lineas.map((l) => ({ producto_id: l.p.id, cantidad: l.cantidad })),
        metodo_pago: metodo,
        ...(metodo === "efectivo" && pago ? { pago_con: pago } : {}),
      },
      {
        deshacer: true,
        exito: (v) => (
          <>
            <b>Venta #{v.venta_id}</b> por {money(v.total)}
            {v.cambio !== undefined && <> · cambio <b>{money(v.cambio)}</b></>}
          </>
        ),
      },
    );
    setCobrando(false);
    if (r) {
      setLineas([]);
      setPagoCon("");
      setMetodo("efectivo");
    }
    input.current?.focus();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F9") (e.preventDefault(), cobrar());
      if (e.key === "Escape" && !document.querySelector(".overlay")) setLineas([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Venta rápida</h1>
        <div className="spacer" />
        <span className="muted small">Escanea o escribe · <b>3*código</b> agrega 3 · <b>F9</b> cobra · <b>Esc</b> limpia</span>
      </div>
      <div className="pos">
        <section>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input
              ref={input}
              className="input lg"
              autoFocus
              placeholder="Código de barras, SKU o nombre…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onEnter(e.currentTarget.value))}
              aria-label="Buscar producto"
            />
          </div>
          <div className="pgrid">
            {data?.productos.map((p) => (
              <button key={p.id} className="pcard" onClick={() => (agregar(p), setQ(""))} disabled={p.stock <= 0} style={p.stock <= 0 ? { opacity: 0.55 } : undefined}>
                {p.foto ? <img src={p.foto} alt="" /> : <div className="ph">{p.nombre.slice(0, 2).toUpperCase()}</div>}
                <div className="n">{p.nombre}</div>
                <div className="p">
                  <span className="price num">{money(p.precio)}</span>
                  <StockBadge stock={p.stock} minimo={p.stock_minimo} />
                </div>
              </button>
            ))}
          </div>
          {data && !data.productos.length && <div className="empty">Sin resultados.</div>}
        </section>

        <aside className="card cart" aria-label="Ticket">
          <div className="card-head">
            <h2>Ticket</h2>
            <div className="spacer" />
            {lineas.length > 0 && (
              <button className="btn ghost sm" onClick={() => setLineas([])}>Limpiar</button>
            )}
          </div>
          <div className="cart-lines">
            {!lineas.length && <div className="empty">Agrega productos para empezar.</div>}
            {lineas.map((l, i) => (
              <div className="cline" key={l.p.id}>
                <div>
                  <div style={{ fontWeight: 600 }}>{l.p.nombre}</div>
                  <div className="muted small num">
                    {money(l.p.precio)} · hay {qty(l.p.stock)}
                    {l.cantidad > l.p.stock && <span className="badge bad" style={{ marginLeft: 6 }}>sin stock suficiente</span>}
                  </div>
                </div>
                <div className="qty">
                  <button onClick={() => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, cantidad: Math.max(1, x.cantidad - 1) } : x)))} aria-label="Menos">−</button>
                  <input
                    className="num"
                    value={l.cantidad}
                    inputMode="decimal"
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(",", "."));
                      if (Number.isFinite(n) && n > 0) setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, cantidad: n } : x)));
                    }}
                    aria-label="Cantidad"
                  />
                  <button onClick={() => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, cantidad: x.cantidad + 1 } : x)))} aria-label="Más">+</button>
                </div>
                <div className="num" style={{ textAlign: "right", minWidth: 80 }}>
                  <div style={{ fontWeight: 600 }}>{money(l.cantidad * l.p.precio)}</div>
                  <button className="btn ghost sm" style={{ height: 22, padding: "0 4px" }} onClick={() => setLineas((ls) => ls.filter((_, k) => k !== i))} aria-label="Quitar">
                    <Icon name="x" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="cart-foot">
            <div className="total">
              <span className="muted">Total · {lineas.reduce((s, l) => s + l.cantidad, 0)} pzas</span>
              <span className="v num">{money(total)}</span>
            </div>
            <div className="seg" role="radiogroup" aria-label="Método de pago">
              {METODOS.map(([id, label]) => (
                <button key={id} className={metodo === id ? "on" : ""} onClick={() => setMetodo(id)} role="radio" aria-checked={metodo === id} style={{ flex: 1 }}>
                  {label}
                </button>
              ))}
            </div>
            {metodo === "efectivo" && (
              <div className="grid2">
                <label className="field">
                  <span>Pagó con</span>
                  <input className="input num" inputMode="decimal" placeholder="0.00" value={pagoCon} onChange={(e) => setPagoCon(e.target.value)} />
                </label>
                <div className="field">
                  <span>Cambio</span>
                  <div className="input num" style={{ display: "flex", alignItems: "center", fontWeight: 700, background: "var(--surface-2)", color: pago && cambio < 0 ? "var(--bad)" : undefined }}>
                    {pago ? money(cambio) : "—"}
                  </div>
                </div>
              </div>
            )}
            <button className="btn primary lg" disabled={!lineas.length || cobrando || (metodo === "efectivo" && pago > 0 && cambio < 0)} onClick={cobrar}>
              {cobrando ? "Cobrando…" : `Cobrar ${money(total)}`}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
