import { useState } from "react";
import { fechaLocal, money, qty, useData } from "../api.ts";
import { useVersion } from "../version.ts";

const RANGOS = [
  { id: "hoy", label: "Hoy", desde: 0 },
  { id: "7", label: "7 días", desde: -6 },
  { id: "30", label: "30 días", desde: -29 },
] as const;

/** Escala "bonita" para el eje: 1, 2, 2.5 o 5 × 10ⁿ. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * exp;
}
const compact = (n: number) => (n >= 1000 ? `$${(n / 1000).toLocaleString("es-MX", { maximumFractionDigits: 1 })}k` : `$${n}`);

function BarrasPorDia({ filas, desde, hasta }: { filas: { grupo: string; importe: number; ventas: number }[]; desde: string; hasta: string }) {
  const [hover, setHover] = useState<number | null>(null);
  // Rellena días sin ventas para que el eje del tiempo sea continuo.
  const dias: { fecha: string; importe: number; ventas: number }[] = [];
  for (let d = new Date(desde + "T12:00"); d <= new Date(hasta + "T12:00"); d.setDate(d.getDate() + 1)) {
    const f = d.toISOString().slice(0, 10);
    const r = filas.find((x) => x.grupo === f);
    dias.push({ fecha: f, importe: r?.importe ?? 0, ventas: r?.ventas ?? 0 });
  }
  const max = niceMax(Math.max(...dias.map((d) => d.importe)));
  const fmtDia = (f: string) => new Date(f + "T12:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  const fmtEje = (f: string) => `${Number(f.slice(8))}/${Number(f.slice(5, 7))}`;
  const cada = Math.ceil(dias.length / 10);
  return (
    <div className="chart" style={{ paddingLeft: 52 }}>
      <div className="bars" role="img" aria-label="Ventas por día">
        {[0.5, 1].map((t) => (
          <div key={t} className="gridline" style={{ bottom: `${t * 100}%` }}>
            <span className="num">{compact(max * t)}</span>
          </div>
        ))}
        {dias.map((d, i) => (
          <div key={d.fecha} className="bar-hit" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="bar" style={{ height: `${(d.importe / max) * 100}%` }} />
            {hover === i && (
              <div className="tip num" style={{ left: "50%", bottom: `${(d.importe / max) * 100}%` }}>
                <b>{fmtDia(d.fecha)}</b> · {money(d.importe)} · {d.ventas} ventas
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="xlabels">
        {dias.map((d, i) => (
          <span key={d.fecha}>{i % cada === 0 ? fmtEje(d.fecha) : ""}</span>
        ))}
      </div>
    </div>
  );
}

export function Reportes() {
  const version = useVersion();
  const [rango, setRango] = useState<string>("30");
  const [desdeC, setDesdeC] = useState(fechaLocal(-6));
  const [hastaC, setHastaC] = useState(fechaLocal(0));
  const r = RANGOS.find((x) => x.id === rango);
  const desde = r ? fechaLocal(r.desde) : desdeC;
  const hasta = r ? fechaLocal(0) : hastaC;

  const dia = useData<any>("reporte_ventas", { desde, hasta, agrupar: "dia" }, [version]);
  const metodo = useData<any>("reporte_ventas", { desde, hasta, agrupar: "metodo_pago" }, [version]);
  const valor = useData<any>("valor_inventario", {}, [version]);
  const bajo = useData<any>("productos_stock_bajo", { dias: 7 }, [version]);
  const quietos = useData<any>("productos_sin_movimiento", { dias: 30 }, [version]);
  const t = dia.data?.totales;
  const maxMetodo = Math.max(1, ...(metodo.data?.filas ?? []).map((f: any) => f.importe));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Reportes</h1>
        <div className="spacer" />
        <div className="seg">
          {RANGOS.map((x) => (
            <button key={x.id} className={rango === x.id ? "on" : ""} onClick={() => setRango(x.id)}>{x.label}</button>
          ))}
          <button className={rango === "custom" ? "on" : ""} onClick={() => setRango("custom")}>Rango</button>
        </div>
        {rango === "custom" && (
          <div className="row">
            <input type="date" className="input" style={{ width: 150 }} value={desdeC} onChange={(e) => setDesdeC(e.target.value)} />
            <input type="date" className="input" style={{ width: 150 }} value={hastaC} onChange={(e) => setHastaC(e.target.value)} />
          </div>
        )}
      </div>

      <div className="kpis">
        <div className="card kpi"><div className="l">Ventas</div><div className="v num">{money(t?.importe)}</div><div className="s">{t?.ventas ?? 0} tickets</div></div>
        <div className="card kpi"><div className="l">Ticket promedio</div><div className="v num">{money(t?.ticket_promedio)}</div><div className="s">{qty(t?.unidades ?? 0)} unidades</div></div>
        <div className="card kpi"><div className="l">Utilidad bruta estimada</div><div className="v num">{money(t?.utilidad_bruta_estimada)}</div><div className="s">Margen {t?.margen_porcentaje ?? 0}%</div></div>
        <div className="card kpi"><div className="l">Inventario al costo</div><div className="v num">{money(valor.data?.total_costo)}</div><div className="s">{money(valor.data?.total_precio)} a precio de venta</div></div>
      </div>

      <div className="cols">
        <div className="stack">
          {rango !== "hoy" && (
            <div className="card">
              <div className="card-head"><h2>Ventas por día</h2></div>
              {dia.data && <BarrasPorDia filas={dia.data.filas} desde={desde} hasta={hasta} />}
            </div>
          )}
          <div className="card">
            <div className="card-head"><h2>Más vendidos</h2></div>
            <table className="table">
              <thead><tr><th>Producto</th><th className="r">Unidades</th><th className="r">Importe</th></tr></thead>
              <tbody>
                {dia.data?.top_productos.map((p: any) => (
                  <tr key={p.id}><td>{p.nombre}</td><td className="r num">{qty(p.unidades)}</td><td className="r num">{money(p.importe)}</td></tr>
                ))}
              </tbody>
            </table>
            {dia.data && !dia.data.top_productos.length && <div className="empty">Sin ventas en este periodo.</div>}
          </div>
          <div className="card">
            <div className="card-head"><h2>Inventario por categoría</h2></div>
            <table className="table">
              <thead><tr><th>Categoría</th><th className="r">Productos</th><th className="r">Unidades</th><th className="r">Al costo</th><th className="r">A precio</th></tr></thead>
              <tbody>
                {valor.data?.por_categoria.map((c: any) => (
                  <tr key={c.categoria}><td>{c.categoria}</td><td className="r num">{c.productos}</td><td className="r num">{qty(c.unidades)}</td><td className="r num">{money(c.valor_costo)}</td><td className="r num muted">{money(c.valor_precio)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Por método de pago</h2></div>
            <div className="card-pad" style={{ paddingTop: 8 }}>
              {metodo.data?.filas.map((f: any) => (
                <div className="hbar" key={f.grupo} title={`${f.ventas} ventas`}>
                  <span style={{ textTransform: "capitalize" }}>{f.grupo}</span>
                  <div className="track"><div className="fill" style={{ width: `${(f.importe / maxMetodo) * 100}%` }} /></div>
                  <span className="num r" style={{ textAlign: "right" }}>{money(f.importe)}</span>
                </div>
              ))}
              {metodo.data && !metodo.data.filas.length && <div className="muted">Sin ventas.</div>}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Por agotarse (7 días)</h2><div className="spacer" /><span className="badge warn">{bajo.data?.total ?? 0}</span></div>
            <table className="table">
              <tbody>
                {bajo.data?.productos.slice(0, 12).map((p: any) => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                      <div className="small muted">{p.dias_restantes === null ? p.motivo : p.dias_restantes === 0 ? "se acaba hoy" : `~${p.dias_restantes} días`} · pedir {p.sugerido_pedir}</div>
                    </td>
                    <td className="r"><span className={`badge ${p.stock <= 0 ? "bad" : "warn"} num`}>{qty(p.stock)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {bajo.data && !bajo.data.total && <div className="empty">Todo bien surtido.</div>}
          </div>
          <div className="card">
            <div className="card-head"><h2>Sin venta en 30 días</h2><div className="spacer" /><span className="muted small num">{money(quietos.data?.valor_detenido)} detenidos</span></div>
            <table className="table">
              <tbody>
                {quietos.data?.productos.slice(0, 8).map((p: any) => (
                  <tr key={p.id}><td>{p.nombre}</td><td className="r num muted">{qty(p.stock)} pzas</td></tr>
                ))}
              </tbody>
            </table>
            {quietos.data && !quietos.data.total && <div className="empty">Todo se está moviendo.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
