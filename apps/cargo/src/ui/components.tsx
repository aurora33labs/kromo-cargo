import { cloneElement, createContext, useCallback, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { call, get, money, qty, type ExecResult } from "./api.ts";

// ── Logo (caja cromada) ─────────────────────────────────────────────
/** Marca de Kromo Cargo. Los ids de los degradados son únicos por instancia para poder repetirla en la página. */
export function Logo({ className, titulo }: { className?: string; titulo?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} viewBox="0 0 64 64" role={titulo ? "img" : undefined} aria-label={titulo} aria-hidden={titulo ? undefined : true}>
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.55" stopColor="#DCE1EA" />
          <stop offset="1" stopColor="#AEB6C4" />
        </linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#C9CFDA" />
          <stop offset="0.45" stopColor="#8B94A4" />
          <stop offset="0.5" stopColor="#E9EDF3" />
          <stop offset="0.62" stopColor="#7C8596" />
          <stop offset="1" stopColor="#555D6C" />
        </linearGradient>
        <linearGradient id={`${id}r`} x1="1" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#6A7383" />
          <stop offset="1" stopColor="#262C36" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#070709" />
      <path d="M32 10 52 21.5 32 33 12 21.5Z" fill={`url(#${id}t)`} />
      <path d="M12 21.5 32 33V55L12 43.5Z" fill={`url(#${id}l)`} />
      <path d="M52 21.5 32 33V55L52 43.5Z" fill={`url(#${id}r)`} />
      <path d="M20.4 16.67 23.6 14.83 43.6 26.33V32.33L40.4 34.17V28.17Z" fill="#A335EE" />
      <path d="M32 33V55M12 21.5 32 33 52 21.5" fill="none" stroke="#C88BF7" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

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
  check: "M20 6L9 17l-5-5",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  ban: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  tienda: "M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  phone: "M7 2h10v20H7zM11 18h2",
  terminal: "M4 17l6-6-6-6M12 19h8",
};

export function Icon({ name }: { name: keyof typeof paths | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
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

/** Un aviso. Los que tienen acción (p. ej. Deshacer) no se cierran solos; el resto espera 6 s y se pausa con el mouse o el foco (WCAG 2.2.1). */
function ToastItem({ t, cerrar }: { t: Toast; cerrar: () => void }) {
  const [pausa, setPausa] = useState(false);
  useEffect(() => {
    if (t.action || pausa) return;
    const timer = setTimeout(cerrar, 6000);
    return () => clearTimeout(timer);
  }, [t.action, pausa, cerrar]);
  return (
    <div
      className={`toast ${t.kind ?? ""}`}
      onMouseEnter={() => setPausa(true)}
      onMouseLeave={() => setPausa(false)}
      onFocus={() => setPausa(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setPausa(false)}
    >
      <div className="msg">{t.msg}</div>
      {t.action && (
        <button
          className="btn sm"
          onClick={() => {
            t.action!.onClick();
            cerrar();
          }}
        >
          {t.action.label}
        </button>
      )}
      <button className="btn ghost icon" onClick={cerrar} aria-label="Cerrar aviso">
        <Icon name="x" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => setToasts((ts) => [...ts.slice(-3), { ...t, id: Math.random() }]), []);
  const cerradores = useRef(new Map<number, () => void>());
  const cerrar = (id: number) => {
    if (!cerradores.current.has(id)) cerradores.current.set(id, () => (setToasts((ts) => ts.filter((x) => x.id !== id)), cerradores.current.delete(id)));
    return cerradores.current.get(id)!;
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        <div role="alert">
          {toasts.filter((t) => t.kind === "error").map((t) => <ToastItem key={t.id} t={t} cerrar={cerrar(t.id)} />)}
        </div>
        <div role="status">
          {toasts.filter((t) => t.kind !== "error").map((t) => <ToastItem key={t.id} t={t} cerrar={cerrar(t.id)} />)}
        </div>
      </div>
    </ToastCtx.Provider>
  );
}

// ── Modal ───────────────────────────────────────────────────────────
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const pilaModales: symbol[] = [];

/** Diálogo modal: foco atrapado, Esc cierra, el foco regresa al elemento que lo abrió. */
export function Modal(props: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; side?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useEffect(() => {
    const yo = Symbol();
    pilaModales.push(yo);
    const anterior = document.activeElement as HTMLElement | null;
    const node = ref.current!;
    const focusables = () => [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    if (!node.contains(document.activeElement)) (focusables()[0] ?? node).focus();
    const onKey = (e: KeyboardEvent) => {
      if (pilaModales.at(-1) !== yo) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose.current();
      } else if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) return e.preventDefault();
        const [primero, ultimo] = [f[0]!, f[f.length - 1]!];
        if (e.shiftKey && (document.activeElement === primero || !node.contains(document.activeElement))) (e.preventDefault(), ultimo.focus());
        else if (!e.shiftKey && (document.activeElement === ultimo || !node.contains(document.activeElement))) (e.preventDefault(), primero.focus());
      }
    };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      pilaModales.splice(pilaModales.indexOf(yo), 1);
      if (!pilaModales.length) document.body.style.overflow = overflow;
      if (anterior?.isConnected) anterior.focus();
    };
  }, []);
  return (
    <div className={`overlay ${props.side ? "side" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={titleId}>{props.title}</h2>
          <button className="btn ghost icon" onClick={props.onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

// ── Formularios ─────────────────────────────────────────────────────
/** Campo con label visible asociado, ayuda y error ligados por aria-describedby. */
export function Field({ label, help, error, children, style, className }: { label: ReactNode; help?: ReactNode; error?: ReactNode; children: ReactElement<any>; style?: CSSProperties; className?: string }) {
  const id = useId();
  const helpId = help ? `${id}-ayuda` : undefined;
  const errId = error ? `${id}-error` : undefined;
  const describedby = [helpId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${className ?? ""}`} style={style}>
      <label htmlFor={id} className="field-label">{label}</label>
      {cloneElement(children, { id, "aria-describedby": describedby, "aria-invalid": error ? true : undefined })}
      {help && <span id={helpId} className="field-help">{help}</span>}
      {error && <span id={errId} className="field-error">{error}</span>}
    </div>
  );
}

/** Botones de opción única (rango, tipo de código, método de pago). */
export function Segmented<T extends string>({ label, value, options, onChange, full }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; full?: boolean }) {
  return (
    <div className={`seg ${full ? "full" : ""}`} role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button type="button" key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Copia al portapapeles y lo anuncia ("Copiado") a lectores de pantalla. */
export function CopyButton({ texto, etiqueta, className = "btn sm" }: { texto: string; etiqueta?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!ok) return;
    const t = setTimeout(() => setOk(false), 2000);
    return () => clearTimeout(t);
  }, [ok]);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={etiqueta}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(texto);
            setOk(true);
          } catch {}
        }}
      >
        <Icon name={ok ? "check" : "copy"} />
        {ok ? "Copiado" : "Copiar"}
      </button>
      <span className="sr-only" role="status">{ok ? "Copiado al portapapeles" : ""}</span>
    </>
  );
}

/** Pestañas accesibles (patrón ARIA tabs): flechas, Inicio y Fin cambian de pestaña. */
export function Tabs<T extends string>({ label, value, onChange, tabs, idBase }: { label: string; value: T; onChange: (v: T) => void; tabs: readonly (readonly [T, string, string?])[]; idBase: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {tabs.map(([id, texto, icono], k) => (
        <button
          key={id}
          ref={(el) => void (refs.current[k] = el)}
          type="button"
          role="tab"
          className="tab"
          id={`${idBase}-tab-${id}`}
          aria-controls={`${idBase}-panel-${id}`}
          aria-selected={value === id}
          tabIndex={value === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(e) => {
            const n = tabs.length;
            const destino = e.key === "ArrowRight" ? (k + 1) % n : e.key === "ArrowLeft" ? (k - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
            if (destino < 0) return;
            e.preventDefault();
            onChange(tabs[destino]![0]);
            refs.current[destino]?.focus();
          }}
        >
          {icono && <Icon name={icono} />}
          {texto}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ idBase, id, activo, children }: { idBase: string; id: string; activo: boolean; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} hidden={!activo} tabIndex={0} className="tabpanel">
      {activo && children}
    </div>
  );
}

/** Iniciales para el avatar de una persona. */
export const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
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
            <div key={k}>
              <dt>{label(k)}</dt>
              <dd className="num">{fmt(k, v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {tablas.map(([k, rows]) => {
        const cols = Object.keys(rows[0]).filter((c) => c !== "id");
        return (
          <div key={k} className="stack tight">
            <h3>{label(k)}</h3>
            <div className="preview" tabIndex={0} role="region" aria-label={label(k)}>
              <table className="table">
                <thead>
                  <tr>{cols.map((c) => <th key={c} scope="col">{label(c)}</th>)}</tr>
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
          <p className="muted">Revisa los cambios. Quedarán en el historial y se pueden deshacer.</p>
          <Preview data={pending.res.vista_previa} />
        </Modal>
      )}
    </ActionCtx.Provider>
  );
}

// ── Selector de producto con autocompletado (combobox ARIA) ─────────
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

export function ProductPicker({ onPick, label, placeholder, autoFocus }: { onPick: (p: ProductoLite) => void; label: string; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ProductoLite[]>([]);
  const [hl, setHl] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const listId = useId();
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
  const abierto = open && items.length > 0;
  return (
    <div className="picker">
      <input
        ref={ref}
        className="input"
        role="combobox"
        aria-label={label}
        aria-expanded={abierto}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={abierto && items[hl] ? `${listId}-${items[hl].id}` : undefined}
        autoComplete="off"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder ?? "Buscar producto por nombre o código…"}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={async (e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setOpen(true), setHl((h) => Math.min(h + 1, items.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setHl((h) => Math.max(h - 1, 0)));
          if (e.key === "Escape" && abierto) (e.preventDefault(), e.stopPropagation(), setOpen(false));
          if (e.key === "Enter") {
            e.preventDefault();
            const exact = await get("buscar_productos", { codigo: q.trim(), limite: 1 }).catch(() => null);
            if (exact?.productos?.[0]) return pick(exact.productos[0]);
            if (items[hl]) pick(items[hl]);
          }
        }}
      />
      <ul id={listId} role="listbox" aria-label="Productos encontrados" className="picker-list" hidden={!abierto}>
        {items.map((p, i) => (
          <li key={p.id} id={`${listId}-${p.id}`} role="option" aria-selected={i === hl} className="picker-item" onMouseDown={(e) => (e.preventDefault(), pick(p))}>
            <span>
              {p.nombre} <span className="muted small">{p.sku}</span>
            </span>
            <span className="muted num small">stock {qty(p.stock)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StockBadge({ stock, minimo }: { stock: number; minimo: number }) {
  if (stock <= 0)
    return (
      <span className="badge bad">
        <Icon name="ban" />
        Agotado
      </span>
    );
  const bajo = stock <= minimo;
  return (
    <span className={`badge ${bajo ? "warn" : ""} num`}>
      {bajo && <Icon name="alert" />}
      {qty(stock)}
      {bajo && <> · bajo<span className="sr-only"> (mínimo {qty(minimo)})</span></>}
    </span>
  );
}

export function Thumb({ foto, nombre }: { foto: string | null; nombre: string }) {
  return foto ? <img className="thumb" src={foto} alt="" /> : <div className="thumb" aria-hidden>{nombre.slice(0, 2).toUpperCase()}</div>;
}

export function ActorBadge({ tipo, cliente, usuario }: { tipo: string; cliente: string | null; usuario?: string | null }) {
  if (tipo === "ia") {
    return (
      <span className="badge ia">
        <Icon name="ia" />
        IA · {cliente ?? "desconocida"}
      </span>
    );
  }
  return <span className="badge">{usuario ?? "Persona"}</span>;
}
