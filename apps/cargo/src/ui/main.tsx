import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { login, logout, sesionInfo, ultimoCambio } from "./api.ts";
import { ActionProvider, Icon, Logo, ToastProvider, useToast } from "./components.tsx";
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

type Tema = "sistema" | "light" | "dark";
const leerTema = (): Tema => {
  try {
    return (localStorage.getItem("kromo-tema") as Tema) || "sistema";
  } catch {
    return "sistema";
  }
};
function aplicarTema(t: Tema) {
  if (t === "sistema") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem("kromo-tema", t);
  } catch {}
}
aplicarTema(leerTema());

function SelectorTema() {
  const [tema, setTema] = useState<Tema>(leerTema);
  const opciones: [Tema, string, string][] = [
    ["sistema", "monitor", "Tema del sistema"],
    ["light", "sun", "Tema Día"],
    ["dark", "moon", "Tema Noche"],
  ];
  return (
    <div className="theme-switch" role="group" aria-label="Tema de color">
      {opciones.map(([t, icon, label]) => (
        <button key={t} type="button" className="btn ghost icon" aria-label={label} title={label} aria-pressed={tema === t} onClick={() => (aplicarTema(t), setTema(t))}>
          <Icon name={icon} />
        </button>
      ))}
    </div>
  );
}

const PRINCIPALES = ["venta", "productos", "entradas", "reportes"];

function Shell({ negocio, usuario, onLogout }: { negocio: string; usuario: { nombre: string; rol: string } | null; onLogout?: () => void }) {
  const page = usePage();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [mas, setMas] = useState(false);
  const last = useRef<number | null>(null);
  const main = useRef<HTMLElement>(null);
  const primera = useRef(true);
  const actual = PAGES.find((p) => p.id === page) ?? PAGES[0];

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

  // Al cambiar de sección: título de la pestaña y foco al encabezado (salvo que la sección ya enfocó su buscador).
  useEffect(() => {
    document.title = `${actual.label} · ${negocio} · Kromo Cargo`;
    setMas(false);
    if (primera.current) return void (primera.current = false);
    requestAnimationFrame(() => {
      if (main.current?.contains(document.activeElement)) return;
      const h1 = main.current?.querySelector<HTMLElement>("h1");
      if (h1) (h1.setAttribute("tabindex", "-1"), h1.focus());
    });
  }, [page, negocio]);

  const Current = actual.C;
  const enlace = (p: (typeof PAGES)[number]) => (
    <a href={`#/${p.id}`} className="nav-item" aria-current={page === p.id ? "page" : undefined}>
      <Icon name={p.icon} />
      {p.label}
      {p.kbd && <kbd className="nav-kbd" aria-label={`atajo ${p.kbd}`}>{p.kbd}</kbd>}
    </a>
  );
  return (
    <VersionCtx.Provider value={version}>
      <a className="skip" href="#contenido" onClick={(e) => (e.preventDefault(), main.current?.focus())}>Saltar al contenido</a>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <Logo className="brand-logo" />
            <div>
              <div className="brand-name">{negocio}</div>
              <div className="brand-sub">Kromo Cargo</div>
            </div>
          </div>
          <nav aria-label="Secciones">
            <ul className="nav">
              {PAGES.map((p) => <li key={p.id}>{enlace(p)}</li>)}
            </ul>
          </nav>
          <div className="sidebar-foot">
            <span className="live">En vivo: ves los cambios de la IA al momento</span>
            {usuario && (
              <div className="user-row">
                <span>{usuario.nombre} · {usuario.rol === "dueno" ? "dueño" : "empleado"}</span>
                {onLogout && (
                  <button className="btn ghost sm" onClick={onLogout}>
                    <Icon name="logout" /> Salir
                  </button>
                )}
              </div>
            )}
            <SelectorTema />
          </div>
        </aside>
        <main className="main" id="contenido" ref={main} tabIndex={-1}>
          <Current key={page} />
        </main>
        <nav className="bottom-nav" aria-label="Secciones">
          {PAGES.filter((p) => PRINCIPALES.includes(p.id)).map((p) => (
            <a key={p.id} href={`#/${p.id}`} aria-current={page === p.id ? "page" : undefined}>
              <Icon name={p.icon} />
              <span>{p.label.replace(" rápida", "")}</span>
            </a>
          ))}
          <button type="button" aria-expanded={mas} aria-controls="menu-mas" aria-current={!PRINCIPALES.includes(actual.id) ? "page" : undefined} onClick={() => setMas((m) => !m)}>
            <Icon name="more" />
            <span>Más</span>
          </button>
          {mas && (
            <ul className="more-menu nav" id="menu-mas">
              {PAGES.filter((p) => !PRINCIPALES.includes(p.id)).map((p) => <li key={p.id}>{enlace(p)}</li>)}
              {onLogout && (
                <li>
                  <button className="nav-item btn ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={onLogout}>
                    <Icon name="logout" /> Salir
                  </button>
                </li>
              )}
              <li style={{ padding: "0.25rem 0.75rem" }}><SelectorTema /></li>
            </ul>
          )}
        </nav>
      </div>
    </VersionCtx.Provider>
  );
}

function Login({ negocio, onOk }: { negocio: string; onOk: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    document.title = `Entrar · ${negocio} · Kromo Cargo`;
  }, [negocio]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    const r = await login(pin);
    setEnviando(false);
    if (r.ok) {
      onOk();
    } else {
      setError(r.error ?? "PIN incorrecto");
      setPin("");
    }
  };
  return (
    <main className="login">
      <form className="card" onSubmit={submit} aria-labelledby="login-titulo">
        <Logo className="brand-logo" />
        <div>
          <h1 id="login-titulo">{negocio}</h1>
          <p className="muted">Kromo Cargo</p>
        </div>
        <div className="field">
          <label htmlFor="pin" className="field-label">Tu PIN</label>
          <input
            id="pin"
            className="input pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            value={pin}
            onChange={(e) => (setPin(e.target.value.replace(/\D/g, "")), setError(""))}
            maxLength={12}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "pin-error" : undefined}
          />
        </div>
        <div role="alert" id="pin-error" className="field-error">{error}</div>
        <button className="btn primary lg" disabled={pin.length < 4 || enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
      </form>
    </main>
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
  if (!info) return <div className="login muted" role="status">Cargando…</div>;
  if (info.requiere_pin && !info.usuario) return <Login negocio={info.negocio} onOk={refresh} />;
  return (
    <ToastProvider>
      <ActionProvider>
        <Shell negocio={info.negocio} usuario={info.usuario} onLogout={info.requiere_pin ? () => logout().then(refresh) : undefined} />
      </ActionProvider>
    </ToastProvider>
  );
}

// El manifest lo sirve el servidor (ver server.ts); se enlaza aquí porque el bundler de HTML no conoce esa ruta.
const manifest = document.createElement("link");
manifest.rel = "manifest";
manifest.href = "/manifest.webmanifest";
document.head.append(manifest);

// Si otra página carga la app dentro de un iframe (clickjacking), no se muestra.
if (window.top !== window.self) document.body.textContent = "Kromo Cargo no se puede mostrar dentro de otra página.";
else createRoot(document.getElementById("root")!).render(<App />);
