import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { call, get, money, qty, type ExecResult } from "./api.ts";

// ── Íconos (trazos simples, 24×24) ─────────────────────────────────
const paths: Record<string, string> = {
  venta: "M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2M10 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01",
  productos: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  entradas: "M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  reportes: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  etiquetas: "M3 3h7l11 11-7 7L3 10zM7.5 7.5h.01",
  importar: "M4 4h16v16H4zM4 9h16M9 4v16",
  historial: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3",
  ajustes: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  plus: "M12 5v14M5 12h14",
  x: "M18 6L6 18M6 6l12 12",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  undo: "M3 7v6h6M3 13a9 9 0 1 0 2.6-6.4L3 9",
  ia: "M12 2l1.8 4.7L18.5 8.5l-4.7 1.8L12 15l-1.8-4.7L5.5 8.5l4.7-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z",
  download: "M12 3v12m0 0l-4-4m4 4l4-4M4 21h16",
  camera: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
};

export function Icon({ name }: { name: keyof typeof paths | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name] ?? ""} />
    </svg>
  );
}

// ── Toasts ──────────────────────────────────────────────────────────
interface Toast {
  id: number;
  msg: ReactNode;
  kind?: "ok" | "error" | "ia" | "info";
  action?: { label: string; onClick: () => void };
}
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random();
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.action ? 9000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind ?? ""}`}>
            <div className="msg">{t.msg}</div>
            {t.action && (
              <button
                className="btn sm"
                onClick={() => {
                  t.action!.onClick();
                  setToasts((ts) => ts.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── Modal ───────────────────────────────────────────────────────────
export function Modal(props: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; side?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);
  return (
    <div className={`overlay ${props.side ? "side" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{props.title}</h2>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={props.onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

// ── Vista previa genérica para confirmaciones en dos pasos ──────────
const ETIQUETAS: Record<string, string> = { accion: "Acción", despues: "Después", categoria: "Categoría", codigo: "Código", valor_al_costo: "Valor al costo" };
const label = (k: string) => ETIQUETAS[k] ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function fmt(k: string, v: unknown): ReactNode {
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "number" && /precio|costo|antes|despues|valor|importe|total/.test(k)) return money(v);
  if (typeof v === "number") return qty(v);
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

export function Preview({ data }: { data: any }) {
  if (data === null || typeof data !== "object") return <p>{String(data)}</p>;
  const esTabla = (v: unknown) => Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null;
  const simples = Object.entries(data).filter(([, v]) => !esTabla(v) && !(Array.isArray(v) && !v.length));
  const tablas = Object.entries(data).filter(([, v]) => esTabla(v)) as [string, any[]][];
  return (
    <div className="stack">
      {simples.length > 0 && (
        <dl className="kv">
          {simples.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{label(k)}</dt>
              <dd className="num">{fmt(k, v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {tablas.map(([k, rows]) => {
        const cols = Object.keys(rows[0]).filter((c) => c !== "id");
        return (
          <div key={k}>
            <h3 style={{ marginBottom: 6 }}>{label(k)}</h3>
            <div className="preview">
              <table className="table">
                <thead>
                  <tr>{cols.map((c) => <th key={c}>{label(c)}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r, i) => (
                    <tr key={i}>{cols.map((c) => <td key={c} className="num">{fmt(c, r[c])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Ejecutar acciones con confirmación y toasts ─────────────────────
interface Pending {
  name: string;
  input: any;
  res: Extract<ExecResult, { requiere_confirmacion: true }>;
  resolve: (r: ExecResult | null) => void;
}
const ActionCtx = createContext<(name: string, input?: any, opts?: { exito?: (r: any) => ReactNode; deshacer?: boolean }) => Promise<any | null>>(
  async () => null,
);
export const useAction = () => useContext(ActionCtx);

export function ActionProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (name: string, input: any = {}, opts: { exito?: (r: any) => ReactNode; deshacer?: boolean } = {}) => {
      let res = await call(name, input);
      if (res.ok && res.requiere_confirmacion) {
        const r1 = res;
        const confirmed = await new Promise<ExecResult | null>((resolve) => setPending({ name, input, res: r1, resolve }));
        if (!confirmed) return null;
        res = confirmed;
      }
      if (!res.ok) {
        toast({ msg: res.error, kind: "error" });
        return null;
      }
      const r = res as Extract<ExecResult, { resultado: any }>;
      if (opts.exito) {
        const hid = r.historial_id;
        toast({
          msg: opts.exito(r.resultado),
          kind: "ok",
          action:
            opts.deshacer && hid
              ? {
                  label: "Deshacer",
                  onClick: async () => {
                    const u = await call("deshacer", { historial_id: hid });
                    toast(u.ok ? { msg: "Listo, se deshizo.", kind: "info" } : { msg: u.error, kind: "error" });
                  },
                }
              : undefined,
        });
      }
      return r.resultado;
    },
    [toast],
  );

  const confirmar = async () => {
    if (!pending) return;
    setBusy(true);
    const r = await call(pending.name, { ...pending.input, token_confirmacion: pending.res.token_confirmacion });
    setBusy(false);
    pending.resolve(r);
    setPending(null);
  };

  return (
    <ActionCtx.Provider value={run}>
      {children}
      {pending && (
        <Modal
          title="Confirma antes de aplicar"
          onClose={() => (pending.resolve(null), setPending(null))}
          footer={
            <>
              <button className="btn" onClick={() => (pending.resolve(null), setPending(null))}>
                Cancelar
              </button>
              <button className="btn primary" disabled={busy} onClick={confirmar} autoFocus>
                {busy ? "Aplicando…" : "Sí, aplicar"}
              </button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>Revisa los cambios. Quedarán en el historial y se pueden deshacer.</p>
          <Preview data={pending.res.vista_previa} />
        </Modal>
      )}
    </ActionCtx.Provider>
  );
}

// ── Selector de producto con autocompletado ─────────────────────────
export interface ProductoLite {
  id: number;
  nombre: string;
  sku: string | null;
  codigo_barras: string | null;
  precio: number;
  costo: number;
  stock: number;
  stock_minimo: number;
  categoria: string | null;
  foto: string | null;
  unidad: string;
}

export function ProductPicker({ onPick, placeholder, autoFocus }: { onPick: (p: ProductoLite) => void; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ProductoLite[]>([]);
  const [hl, setHl] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!q.trim()) return setItems([]);
    const t = setTimeout(async () => {
      const r = await get("buscar_productos", { texto: q, limite: 12 }).catch(() => ({ productos: [] }));
      setItems(r.productos);
      setHl(0);
    }, 120);
    return () => clearTimeout(t);
  }, [q]);
  const pick = (p: ProductoLite) => {
    onPick(p);
    setQ("");
    setItems([]);
    ref.current?.focus();
  };
  return (
    <div className="picker">
      <input
        ref={ref}
        className="input"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder ?? "Buscar producto por nombre o código…"}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={async (e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setHl((h) => Math.min(h + 1, items.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setHl((h) => Math.max(h - 1, 0)));
          if (e.key === "Enter") {
            e.preventDefault();
            const exact = await get("buscar_productos", { codigo: q.trim(), limite: 1 }).catch(() => null);
            if (exact?.productos?.[0]) return pick(exact.productos[0]);
            if (items[hl]) pick(items[hl]);
          }
        }}
      />
      {open && items.length > 0 && (
        <div className="picker-list">
          {items.map((p, i) => (
            <div key={p.id} className={`picker-item ${i === hl ? "hl" : ""}`} onMouseDown={() => pick(p)}>
              <span>
                {p.nombre} <span className="muted small">{p.sku}</span>
              </span>
              <span className="muted num small">stock {qty(p.stock)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StockBadge({ stock, minimo }: { stock: number; minimo: number }) {
  const cls = stock <= 0 ? "bad" : stock <= minimo ? "warn" : "";
  return (
    <span className={`badge ${cls} num`} title={stock <= minimo ? `Mínimo: ${qty(minimo)}` : undefined}>
      {stock <= 0 ? "Agotado" : qty(stock)}
      {stock > 0 && stock <= minimo ? " · bajo" : ""}
    </span>
  );
}

export function Thumb({ foto, nombre }: { foto: string | null; nombre: string }) {
  return foto ? <img className="thumb" src={foto} alt="" /> : <div className="thumb">{nombre.slice(0, 2).toUpperCase()}</div>;
}

export function ActorBadge({ tipo, cliente, usuario }: { tipo: string; cliente: string | null; usuario?: string | null }) {
  if (tipo === "ia") {
    return (
      <span className="badge ia">
        <span style={{ width: 12, height: 12, display: "inline-flex" }}>
          <Icon name="ia" />
        </span>
        IA · {cliente ?? "desconocida"}
      </span>
    );
  }
  return <span className="badge">{usuario ?? "Persona"}</span>;
}
