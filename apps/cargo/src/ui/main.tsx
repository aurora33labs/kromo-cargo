import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { login, logout, sesionInfo, ultimoCambio } from "./api.ts";
import { ActionProvider, Icon, ToastProvider, useToast } from "./components.tsx";
import { Ajustes } from "./pages/Ajustes.tsx";
import { Entradas } from "./pages/Entradas.tsx";
import { Etiquetas } from "./pages/Etiquetas.tsx";
import { Historial } from "./pages/Historial.tsx";
import { Importar } from "./pages/Importar.tsx";
import { Productos } from "./pages/Productos.tsx";
import { Reportes } from "./pages/Reportes.tsx";
import { Venta } from "./pages/Venta.tsx";
import { VersionCtx } from "./version.ts";


const PAGES = [
  { id: "venta", label: "Venta rápida", icon: "venta", kbd: "F1", C: Venta },
  { id: "productos", label: "Productos", icon: "productos", kbd: "F2", C: Productos },
  { id: "entradas", label: "Entradas", icon: "entradas", kbd: "F3", C: Entradas },
  { id: "reportes", label: "Reportes", icon: "reportes", kbd: "F4", C: Reportes },
  { id: "etiquetas", label: "Etiquetas", icon: "etiquetas", kbd: "", C: Etiquetas },
  { id: "importar", label: "Importar / exportar", icon: "importar", kbd: "", C: Importar },
  { id: "historial", label: "Historial", icon: "historial", kbd: "", C: Historial },
  { id: "ajustes", label: "Ajustes e IA", icon: "ajustes", kbd: "", C: Ajustes },
] as const;

function usePage() {
  const read = () => (location.hash.slice(2) || "venta") as string;
  const [page, setPage] = useState(read);
  useEffect(() => {
    const on = () => setPage(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return page;
}

function Shell({ negocio, usuario, onLogout }: { negocio: string; usuario: { nombre: string; rol: string } | null; onLogout?: () => void }) {
  const page = usePage();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const last = useRef<number | null>(null);

  // Detecta cambios hechos por otros (la IA vía MCP o en otra pestaña) y refresca.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const c = await ultimoCambio().catch(() => null);
      if (!alive || !c) return;
      if (last.current !== null && c.id !== last.current) {
        setVersion((v) => v + 1);
        if (c.actor_tipo === "ia") toast({ kind: "ia", msg: <><b>IA · {c.actor_cliente}</b><br />{c.resumen}</> });
      }
      last.current = c.id;
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = PAGES.find((p) => p.kbd && p.kbd === e.key);
      if (p) (e.preventDefault(), (location.hash = `#/${p.id}`));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const Current = (PAGES.find((p) => p.id === page) ?? PAGES[0]).C;
  return (
    <VersionCtx.Provider value={version}>
      <div className="shell">
        <nav className="sidebar" aria-label="Secciones">
          <div className="brand">
            <div className="brand-logo">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinejoin="round">
                <path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" />
              </svg>
            </div>
            <div>
              <div className="brand-name">{negocio}</div>
              <div className="brand-sub">Kromo Cargo</div>
            </div>
          </div>
          {PAGES.map((p) => (
            <a key={p.id} href={`#/${p.id}`} className={`nav-item ${page === p.id ? "active" : ""}`}>
              <Icon name={p.icon} />
              {p.label}
              {p.kbd && <span className="nav-kbd">{p.kbd}</span>}
            </a>
          ))}
          <div className="sidebar-foot">
            <span className="live">Conectado · cambios en vivo</span>
            {usuario && (
              <span>
                {usuario.nombre} ({usuario.rol === "dueno" ? "dueño" : "empleado"})
                {onLogout && (
                  <>
                    {" · "}
                    <a href="#" onClick={(e) => (e.preventDefault(), onLogout())}>salir</a>
                  </>
                )}
              </span>
            )}
          </div>
        </nav>
        <main className="main">
          <Current key={page} />
        </main>
      </div>
    </VersionCtx.Provider>
  );
}

function Login({ negocio, onOk }: { negocio: string; onOk: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await login(pin);
    if (r.ok) {
      onOk();
    } else {
      setError(r.error ?? "PIN incorrecto");
      setPin("");
    }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>{negocio}</h1>
        <p className="muted" style={{ margin: 0 }}>Ingresa tu PIN</p>
        <input className="input pin" type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} maxLength={12} aria-label="PIN" />
        {error && <span className="badge bad" style={{ justifySelf: "center" }}>{error}</span>}
        <button className="btn primary lg" disabled={pin.length < 4}>Entrar</button>
      </form>
    </div>
  );
}

function App() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof sesionInfo>> | null>(null);
  const refresh = () => sesionInfo().then(setInfo).catch(() => setInfo(null));
  useEffect(() => {
    refresh();
    const on = () => refresh();
    window.addEventListener("sesion-expirada", on);
    return () => window.removeEventListener("sesion-expirada", on);
  }, []);
  useEffect(() => {
    if (info) document.title = `${info.negocio} · Kromo Cargo`;
  }, [info]);
  if (!info) return <div className="login muted">Cargando…</div>;
  if (info.requiere_pin && !info.usuario) return <Login negocio={info.negocio} onOk={refresh} />;
  return (
    <ToastProvider>
      <ActionProvider>
        <Shell negocio={info.negocio} usuario={info.usuario} onLogout={info.requiere_pin ? () => logout().then(refresh) : undefined} />
      </ActionProvider>
    </ToastProvider>
  );
}

// Si otra página carga la app dentro de un iframe (clickjacking), no se muestra.
if (window.top !== window.self) document.body.textContent = "Kromo Cargo no se puede mostrar dentro de otra página.";
else createRoot(document.getElementById("root")!).render(<App />);
