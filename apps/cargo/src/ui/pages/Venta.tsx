import { useEffect, useRef, useState } from "react";
import { get, money, qty, useData } from "../api.ts";
import { EmptyState, Field, Icon, Segmented, StockBadge, useAction, useToast, type ProductoLite } from "../components.tsx";
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

  const piezas = lineas.reduce((s, l) => s + l.cantidad, 0);
  const cambiar = (i: number, cantidad: number) => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, cantidad } : x)));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Venta rápida</h1>
        <div className="page-actions">
          <p className="hint" id="venta-ayuda">
            Escanea o escribe · <kbd>3*código</kbd> agrega 3 · <kbd>F9</kbd> cobra · <kbd>Esc</kbd> limpia
          </p>
        </div>
      </div>
      <div className="pos">
        <section className="pos-main" aria-label="Productos">
          <label htmlFor="venta-buscar" className="sr-only">Buscar producto</label>
          <input
            id="venta-buscar"
            ref={input}
            className="input lg"
            autoFocus
            autoComplete="off"
            placeholder="Código de barras, SKU o nombre…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onEnter(e.currentTarget.value))}
            aria-describedby="venta-ayuda"
          />
          <ul className="pgrid" aria-label="Resultados">
            {data?.productos.map((p) => {
              const agotado = p.stock <= 0;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="pcard"
                    aria-disabled={agotado || undefined}
                    onClick={() => (agotado ? toast({ msg: `${p.nombre} está agotado.`, kind: "error" }) : (agregar(p), setQ("")))}
                  >
                    {p.foto ? <img src={p.foto} alt="" /> : <div className="ph" aria-hidden>{p.nombre.slice(0, 2).toUpperCase()}</div>}
                    <span className="n">{p.nombre}</span>
                    <span className="p">
                      <span className="price num">{money(p.precio)}</span>
                      <StockBadge stock={p.stock} minimo={p.stock_minimo} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {data && !data.productos.length && (
            <EmptyState action={busqueda ? undefined : <a className="btn primary" href="#/productos">Agregar productos</a>}>
              {busqueda ? `Sin resultados para “${busqueda}”.` : "Todavía no hay productos en el catálogo."}
            </EmptyState>
          )}
          {lineas.length > 0 && (
            <button
              type="button"
              className="btn primary lg cart-summary"
              onClick={() => {
                document.getElementById("ticket")?.scrollIntoView({ behavior: "smooth", block: "start" });
                document.getElementById("ticket-titulo")?.focus();
              }}
            >
              <span>Ver ticket · {qty(piezas)} {piezas === 1 ? "pieza" : "piezas"}</span>
              <span className="num">{money(total)}</span>
            </button>
          )}
        </section>

        <section className="card cart" id="ticket" aria-labelledby="ticket-titulo">
          <div className="card-head">
            <h2 id="ticket-titulo" tabIndex={-1}>Ticket</h2>
            {lineas.length > 0 && (
              <button className="btn ghost sm" onClick={() => setLineas([])}>Limpiar</button>
            )}
          </div>
          {!lineas.length && <EmptyState>Escanea o toca un producto para empezar.</EmptyState>}
          <ul className="cart-lines" aria-label="Productos en el ticket" hidden={!lineas.length}>
            {lineas.map((l, i) => (
              <li className="cline" key={l.p.id}>
                <div className="cline-info">
                  <div className="strong">{l.p.nombre}</div>
                  <div className="muted small num">
                    {money(l.p.precio)} · hay {qty(l.p.stock)}
                  </div>
                  {l.cantidad > l.p.stock && (
                    <span className="badge bad"><Icon name="alert" /> Sin stock suficiente</span>
                  )}
                </div>
                <div className="qty" role="group" aria-label={`Cantidad de ${l.p.nombre}`}>
                  <button type="button" onClick={() => cambiar(i, Math.max(1, l.cantidad - 1))} aria-label={`Quitar una pieza de ${l.p.nombre}`}>−</button>
                  <input
                    className="num"
                    value={l.cantidad}
                    inputMode="decimal"
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(",", "."));
                      if (Number.isFinite(n) && n > 0) cambiar(i, n);
                    }}
                    aria-label={`Cantidad de ${l.p.nombre}`}
                  />
                  <button type="button" onClick={() => cambiar(i, l.cantidad + 1)} aria-label={`Agregar una pieza de ${l.p.nombre}`}>+</button>
                </div>
                <div className="line-total num">
                  <div className="strong">{money(l.cantidad * l.p.precio)}</div>
                  <button className="btn ghost icon" onClick={() => setLineas((ls) => ls.filter((_, k) => k !== i))} aria-label={`Quitar ${l.p.nombre} del ticket`}>
                    <Icon name="x" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="cart-foot">
            <div className="total" aria-live="polite" aria-atomic="true">
              <span className="muted">Total · {qty(piezas)} {piezas === 1 ? "pieza" : "piezas"}</span>
              <span className="v num">{money(total)}</span>
            </div>
            <Segmented label="Método de pago" value={metodo} options={METODOS} onChange={setMetodo} full />
            {metodo === "efectivo" && (
              <div className="grid2">
                <Field label="Pagó con">
                  <input className="input num" inputMode="decimal" placeholder="0.00" value={pagoCon} onChange={(e) => setPagoCon(e.target.value)} />
                </Field>
                <div className="field">
                  <span className="field-label" id="cambio-label">Cambio</span>
                  <output className="input-static num" aria-labelledby="cambio-label" style={pago && cambio < 0 ? { color: "var(--bad-text)" } : undefined}>
                    {pago ? (cambio < 0 ? `Faltan ${money(-cambio)}` : money(cambio)) : "—"}
                  </output>
                </div>
              </div>
            )}
            <button className="btn primary lg" disabled={!lineas.length || cobrando || (metodo === "efectivo" && pago > 0 && cambio < 0)} onClick={cobrar}>
              {cobrando ? "Cobrando…" : `Cobrar ${money(total)}`}
              {!cobrando && <kbd style={{ marginLeft: "0.25rem" }}>F9</kbd>}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
