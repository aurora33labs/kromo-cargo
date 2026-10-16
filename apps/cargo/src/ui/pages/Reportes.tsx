import { useState } from "react";
import { fechaLocal, money, qty, useData } from "../api.ts";
import { EmptyState, Field, Segmented } from "../components.tsx";
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
  const activo = hover !== null ? dias[hover] : null;
  const total = dias.reduce((t, d) => t + d.importe, 0);
  const mejor = dias.reduce((m, d) => (d.importe > m.importe ? d : m), dias[0]!);
  return (
    <>
      <div className="chart">
        <div
          className="bars"
          tabIndex={0}
          role="group"
          aria-roledescription="gráfica de barras"
          aria-label={`Ventas por día: ${money(total)} en ${dias.length} días; el mejor fue ${fmtDia(mejor.fecha)} con ${money(mejor.importe)}. Usa las flechas para recorrer los días.`}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            const n = dias.length - 1;
            setHover((h) => (e.key === "Home" ? 0 : e.key === "End" ? n : h === null ? (e.key === "ArrowLeft" ? n : 0) : Math.max(0, Math.min(n, h + (e.key === "ArrowLeft" ? -1 : 1)))));
          }}
          onBlur={() => setHover(null)}
        >
          {[0.5, 1].map((t) => (
            <div key={t} className="gridline" style={{ bottom: `${t * 100}%` }} aria-hidden>
              <span className="num">{compact(max * t)}</span>
            </div>
          ))}
          {dias.map((d, i) => (
            <div key={d.fecha} className="bar-hit" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} aria-hidden>
              <div className="bar" style={{ height: `${(d.importe / max) * 100}%`, filter: hover === i ? "brightness(1.15)" : undefined }} />
              {hover === i && (
                <div className="tip num" style={{ left: "50%", bottom: `${(d.importe / max) * 100}%` }}>
                  <b>{fmtDia(d.fecha)}</b> · {money(d.importe)} · {d.ventas} ventas
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="xlabels" aria-hidden>
          {dias.map((d, i) => (
            <span key={d.fecha}>{i % cada === 0 ? fmtEje(d.fecha) : ""}</span>
          ))}
        </div>
        <div className="sr-only" aria-live="polite">{activo ? `${fmtDia(activo.fecha)}: ${money(activo.importe)}, ${activo.ventas} ventas` : ""}</div>
      </div>
      <details className="data-table">
        <summary>Ver como tabla</summary>
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Ventas por día</caption>
            <thead><tr><th scope="col">Día</th><th scope="col" className="r">Ventas</th><th scope="col" className="r">Importe</th></tr></thead>
            <tbody>
              {dias.map((d) => (
                <tr key={d.fecha}><td>{fmtDia(d.fecha)}</td><td className="r num">{d.ventas}</td><td className="r num">{money(d.importe)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
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
        <div className="page-actions">
          {rango === "custom" && (
            <div className="row end">
              <Field label="Desde"><input type="date" className="input" value={desdeC} max={hastaC} onChange={(e) => setDesdeC(e.target.value)} /></Field>
              <Field label="Hasta"><input type="date" className="input" value={hastaC} min={desdeC} onChange={(e) => setHastaC(e.target.value)} /></Field>
            </div>
          )}
          <Segmented label="Periodo" value={rango} options={[...RANGOS.map((x) => [x.id, x.label] as const), ["custom", "Otro rango"] as const]} onChange={setRango} />
        </div>
      </div>

      <h2 className="sr-only">Resumen del periodo</h2>
      <dl className="kpis" style={{ margin: "0 0 1rem" }}>
        <div className="card kpi"><dt className="l">Ventas</dt><dd className="v num" style={{ margin: 0 }}>{money(t?.importe)}</dd><dd className="s" style={{ margin: 0 }}>{t?.ventas ?? 0} tickets</dd></div>
        <div className="card kpi"><dt className="l">Ticket promedio</dt><dd className="v num" style={{ margin: 0 }}>{money(t?.ticket_promedio)}</dd><dd className="s" style={{ margin: 0 }}>{qty(t?.unidades ?? 0)} unidades</dd></div>
        <div className="card kpi"><dt className="l">Utilidad bruta estimada</dt><dd className="v num" style={{ margin: 0 }}>{money(t?.utilidad_bruta_estimada)}</dd><dd className="s" style={{ margin: 0 }}>Margen {t?.margen_porcentaje ?? 0}%</dd></div>
        <div className="card kpi"><dt className="l">Inventario al costo</dt><dd className="v num" style={{ margin: 0 }}>{money(valor.data?.total_costo)}</dd><dd className="s" style={{ margin: 0 }}>{money(valor.data?.total_precio)} a precio de venta</dd></div>
      </dl>

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
              <thead><tr><th scope="col">Producto</th><th scope="col" className="r">Unidades</th><th scope="col" className="r">Importe</th></tr></thead>
              <tbody>
                {dia.data?.top_productos.map((p: any) => (
                  <tr key={p.id}><td>{p.nombre}</td><td className="r num">{qty(p.unidades)}</td><td className="r num">{money(p.importe)}</td></tr>
                ))}
              </tbody>
            </table>
            {dia.data && !dia.data.top_productos.length && <EmptyState action={<a className="btn" href="#/venta">Ir a Venta rápida</a>}>Sin ventas en este periodo.</EmptyState>}
          </div>
          <div className="card">
            <div className="card-head"><h2>Inventario por categoría</h2></div>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Inventario por categoría">
            <table className="table">
              <thead><tr><th scope="col">Categoría</th><th scope="col" className="r">Productos</th><th scope="col" className="r">Unidades</th><th scope="col" className="r">Al costo</th><th scope="col" className="r">A precio</th></tr></thead>
              <tbody>
                {valor.data?.por_categoria.map((c: any) => (
                  <tr key={c.categoria}><td>{c.categoria}</td><td className="r num">{c.productos}</td><td className="r num">{qty(c.unidades)}</td><td className="r num">{money(c.valor_costo)}</td><td className="r num muted">{money(c.valor_precio)}</td></tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Por método de pago</h2></div>
            <div className="card-pad" style={{ paddingTop: "0.5rem" }}>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {metodo.data?.filas.map((f: any) => (
                  <li className="hbar" key={f.grupo}>
                    <span style={{ textTransform: "capitalize" }}>{f.grupo}</span>
                    <div className="track" aria-hidden><div className="fill" style={{ width: `${(f.importe / maxMetodo) * 100}%` }} /></div>
                    <span className="num" style={{ textAlign: "right" }}>{money(f.importe)} <span className="muted small">· {f.ventas}</span><span className="sr-only"> ventas</span></span>
                  </li>
                ))}
              </ul>
              {metodo.data && !metodo.data.filas.length && <p className="muted">Sin ventas.</p>}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Por agotarse (7 días)</h2><span className="badge warn">{bajo.data?.total ?? 0}<span className="sr-only"> productos</span></span></div>
            <table className="table">
              <tbody>
                {bajo.data?.productos.slice(0, 12).map((p: any) => (
                  <tr key={p.id}>
                    <td>
                      <div className="strong">{p.nombre}</div>
                      <div className="small muted">{p.dias_restantes === null ? p.motivo : p.dias_restantes === 0 ? "se acaba hoy" : `~${p.dias_restantes} ${p.dias_restantes === 1 ? "día" : "días"}`} · pedir {p.sugerido_pedir}</div>
                    </td>
                    <td className="r"><span className={`badge ${p.stock <= 0 ? "bad" : "warn"} num`}>{p.stock <= 0 ? "Agotado" : `quedan ${qty(p.stock)}`}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {bajo.data && !bajo.data.total && <EmptyState>Todo bien surtido.</EmptyState>}
          </div>
          <div className="card">
            <div className="card-head"><h2>Sin venta en 30 días</h2><span className="muted small num">{money(quietos.data?.valor_detenido)} detenidos</span></div>
            <table className="table">
              <tbody>
                {quietos.data?.productos.slice(0, 8).map((p: any) => (
                  <tr key={p.id}><td>{p.nombre}</td><td className="r num muted">{qty(p.stock)} pzas</td></tr>
                ))}
              </tbody>
            </table>
            {quietos.data && !quietos.data.total && <EmptyState>Todo se está moviendo.</EmptyState>}
          </div>
        </div>
      </div>
    </div>
  );
}
