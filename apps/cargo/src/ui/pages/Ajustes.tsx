import { useEffect, useState } from "react";
import { haceCuanto, sesionInfo, useData, type Despliegue } from "../api.ts";
import { CopyButton, EmptyState, Field, Icon, Modal, Segmented, TabPanel, Tabs, iniciales, useAction } from "../components.tsx";
import { KOFI_URL, NUBE_URL, TarjetaNube, mostrarApoyo } from "../promo.tsx";
import { useVersion } from "../version.ts";

const PREGUNTAS = [
  "¿Qué se me va a acabar esta semana?",
  "¿Cuánto vendí hoy y qué fue lo que más salió?",
  "Llegaron 24 Coca-Cola 600 ml a $13.80 cada una.",
  "Sube 8% el precio de las bebidas, redondeado al peso.",
];

type Pestana = "ia" | "usuarios" | "negocio" | "dominio";
const PESTANAS = [
  ["ia", "Conectar IA", "ia"],
  ["usuarios", "Usuarios", "users"],
  ["negocio", "Negocio", "tienda"],
  ["dominio", "Dominio", "globe"],
] as const;

const leerPestana = (): Pestana => {
  try {
    return (sessionStorage.getItem("kromo-ajustes") as Pestana) || "ia";
  } catch {
    return "ia";
  }
};

export function Ajustes() {
  const version = useVersion();
  const cfg = useData<any>("ver_configuracion", {}, [version]);
  const [pestana, setPestana] = useState<Pestana>(leerPestana);
  const cambiar = (p: Pestana) => {
    setPestana(p);
    try {
      sessionStorage.setItem("kromo-ajustes", p);
    } catch {}
  };

  const servidor = cfg.data?.modo === "servidor";
  // El dominio propio solo aplica cuando la app está en un servidor (Railway o Docker).
  const pestanas = PESTANAS.filter(([id]) => id !== "dominio" || servidor);
  const activa = pestanas.some(([id]) => id === pestana) ? pestana : "ia";
  const despliegue: Despliegue = cfg.data?.despliegue ?? "local";
  const urlMcp = cfg.data?.url_mcp ?? `${location.origin}/mcp`;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Ajustes</h1>
      </div>
      <Tabs label="Secciones de ajustes" idBase="ajustes" value={activa} onChange={cambiar} tabs={pestanas} />
      <TabPanel idBase="ajustes" id="ia" activo={activa === "ia"}>
        {cfg.data && (despliegue === "docker" ? <ConectarDocker urlMcp={urlMcp} /> : servidor ? <ConectarEnLinea urlMcp={urlMcp} /> : <ConectarLocal />)}
      </TabPanel>
      <TabPanel idBase="ajustes" id="usuarios" activo={activa === "usuarios"}>
        <Usuarios />
      </TabPanel>
      <TabPanel idBase="ajustes" id="negocio" activo={activa === "negocio"}>
        {cfg.data && <Negocio cfg={cfg.data} />}
      </TabPanel>
      {servidor && (
        <TabPanel idBase="ajustes" id="dominio" activo={activa === "dominio"}>
          {cfg.data && <Dominio cfg={cfg.data} />}
        </TabPanel>
      )}
    </div>
  );
}

// ── Conectar IA ─────────────────────────────────────────────────────

const PASOS: Record<"claude" | "chatgpt", (url: string) => { titulo: string; detalle: React.ReactNode }[]> = {
  claude: (url) => [
    { titulo: "Abre Claude", detalle: <>En la app o en claude.ai, entra a <b>Configuración → Conectores</b>.</> },
    { titulo: "Agrega el conector", detalle: <>Toca <b>Agregar conector personalizado</b>, ponle de nombre <b>Kromo Cargo</b> y pega esta dirección:<Direccion url={url} /></> },
    { titulo: "Autoriza con tu cuenta", detalle: <>Se abre la página de tu tienda. Entra con tu <b>usuario y contraseña de dueño</b> y toca <b>Permitir</b>. Listo.</> },
  ],
  chatgpt: (url) => [
    { titulo: "Abre ChatGPT", detalle: <>Entra a <b>Configuración → Apps y conectores → Avanzado</b> y activa el <b>Modo desarrollador</b>.</> },
    { titulo: "Crea el conector", detalle: <>Toca <b>Crear</b>, ponle de nombre <b>Kromo Cargo</b>, elige autenticación <b>OAuth</b> y pega esta dirección:<Direccion url={url} /></> },
    { titulo: "Autoriza con tu cuenta", detalle: <>Se abre la página de tu tienda. Entra con tu <b>usuario y contraseña de dueño</b> y toca <b>Permitir</b>. Listo.</> },
  ],
};

function Direccion({ url }: { url: string }) {
  return (
    <span className="copy-row" style={{ marginTop: "0.5rem" }}>
      <code className="block">{url}</code>
      <CopyButton texto={url} etiqueta="Copiar dirección" className="btn primary sm" />
    </span>
  );
}

function Pasos({ pasos }: { pasos: { titulo: string; detalle: React.ReactNode }[] }) {
  return (
    <ol className="pasos">
      {pasos.map((p) => (
        <li key={p.titulo}>
          <span className="paso-titulo">{p.titulo}</span>
          <span className="paso-detalle">{p.detalle}</span>
        </li>
      ))}
    </ol>
  );
}

/** Modo servidor: Claude y ChatGPT (app, web o celular) se conectan por internet. */
function ConectarEnLinea({ urlMcp }: { urlMcp: string }) {
  const [app, setApp] = useState<"claude" | "chatgpt">("claude");
  return (
    <div className="cols">
      <section className="card" aria-labelledby="conectar-titulo">
        <div className="card-head">
          <span className="ico"><Icon name="ia" /></span>
          <h2 id="conectar-titulo">Conecta tu IA en 3 pasos</h2>
        </div>
        <div className="card-pad stack">
          <p className="muted">Funciona en la app de escritorio, en la web y en el celular. Solo se hace una vez.</p>
          <Segmented label="¿Qué IA usas?" value={app} options={[["claude", "Claude"], ["chatgpt", "ChatGPT"]] as const} onChange={setApp} full />
          <Pasos pasos={PASOS[app](urlMcp)} />
          <OtrosAgentes urlMcp={urlMcp} />
        </div>
      </section>
      <div className="stack">
        <IasConectadas />
        <PruebaPedirle />
      </div>
    </div>
  );
}

/** Modo local: Claude de escritorio se conecta en esta computadora; ChatGPT y el celular necesitan la versión en línea. */
function ConectarLocal() {
  return (
    <div className="cols">
      <section className="card" aria-labelledby="conectar-titulo">
        <div className="card-head">
          <span className="ico"><Icon name="ia" /></span>
          <h2 id="conectar-titulo">Conecta tu IA</h2>
        </div>
        <div className="card-pad stack">
          <div className="opcion">
            <span className="opcion-ico"><Icon name="monitor" /></span>
            <div className="stack tight">
              <h3 className="opcion-titulo">Claude en esta computadora</h3>
              <p>Si instalaste con el prompt, <b>ya está conectado</b>: abre la app de Claude y pregúntale por tu inventario.</p>
              <details className="mas">
                <summary>¿No aparece? Conéctalo de nuevo</summary>
                <p className="muted small">Abre una terminal, pega esto y reinicia Claude:</p>
                <span className="copy-row">
                  <code className="block">kromo-cargo conectar</code>
                  <CopyButton texto="kromo-cargo conectar" etiqueta="Copiar comando" />
                </span>
              </details>
            </div>
          </div>
          <div className="opcion">
            <span className="opcion-ico"><Icon name="phone" /></span>
            <div className="stack tight">
              <h3 className="opcion-titulo">ChatGPT, Claude en el celular o en la web</h3>
              <p>Esas apps solo se conectan por internet, así que necesitan la <b>versión en línea</b> de tu tienda. Aurora33 te la deja lista.</p>
              <a className="btn" href={NUBE_URL} style={{ alignSelf: "flex-start" }}>
                Pedir la versión en línea
              </a>
            </div>
          </div>
          <details className="mas">
            <summary>Otros agentes: Claude Code, Codex, Gemini CLI</summary>
            <p className="muted small">El mismo comando los registra todos los que tengas instalados:</p>
            <span className="copy-row">
              <code className="block">kromo-cargo conectar</code>
              <CopyButton texto="kromo-cargo conectar" etiqueta="Copiar comando para agentes" />
            </span>
          </details>
        </div>
      </section>
      <div className="stack">
        <PruebaPedirle />
      </div>
    </div>
  );
}

/** Docker en esta computadora: la IA de escritorio entra por `docker exec`; los agentes de terminal también por HTTP con token. */
function ConectarDocker({ urlMcp }: { urlMcp: string }) {
  const desktop = JSON.stringify({ mcpServers: { "kromo-cargo": { command: "docker", args: ["exec", "-i", "kromo-cargo", "kromo-cargo", "mcp"] } } });
  const code = "claude mcp add --scope user kromo-cargo -- docker exec -i kromo-cargo kromo-cargo mcp";
  return (
    <div className="cols">
      <section className="card" aria-labelledby="conectar-titulo">
        <div className="card-head">
          <span className="ico"><Icon name="ia" /></span>
          <h2 id="conectar-titulo">Conecta tu IA</h2>
        </div>
        <div className="card-pad stack">
          <p className="muted">Kromo Cargo corre en Docker en esta computadora. La IA se conecta directo al contenedor, sin contraseñas ni tokens.</p>
          <div className="opcion">
            <span className="opcion-ico"><Icon name="monitor" /></span>
            <div className="stack tight">
              <h3 className="opcion-titulo">Claude de escritorio</h3>
              <p>
                En Claude abre <b>Configuración → Desarrollador → Editar configuración</b>, pega esto en <code>claude_desktop_config.json</code> y reinicia Claude:
              </p>
              <span className="copy-row">
                <code className="block pre">{desktop}</code>
                <CopyButton texto={desktop} etiqueta="Copiar configuración para Claude de escritorio" />
              </span>
            </div>
          </div>
          <div className="opcion">
            <span className="opcion-ico"><Icon name="terminal" /></span>
            <div className="stack tight">
              <h3 className="opcion-titulo">Claude Code</h3>
              <span className="copy-row">
                <code className="block">{code}</code>
                <CopyButton texto={code} etiqueta="Copiar comando para Claude Code" />
              </span>
            </div>
          </div>
          <div className="opcion">
            <span className="opcion-ico"><Icon name="phone" /></span>
            <div className="stack tight">
              <h3 className="opcion-titulo">ChatGPT, Claude en el celular o en la web</h3>
              <p>Esas apps se conectan por internet: necesitan tu tienda en la nube. Aurora33 te la deja lista, o conecta un dominio en la pestaña <b>Dominio</b>.</p>
              <a className="btn" href={NUBE_URL} style={{ alignSelf: "flex-start" }}>
                Pedir la versión en línea
              </a>
            </div>
          </div>
          <OtrosAgentes urlMcp={urlMcp} />
        </div>
      </section>
      <div className="stack">
        <PruebaPedirle />
      </div>
    </div>
  );
}

function OtrosAgentes({ urlMcp }: { urlMcp: string }) {
  const run = useAction();
  const [nombre, setNombre] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const tk = token ?? "<TOKEN>";
  return (
    <details className="mas">
      <summary>Otros agentes: Claude Code, Gemini CLI (con token)</summary>
      <div className="stack tight" style={{ marginTop: "0.75rem" }}>
        <div className="row end">
          <Field label="Nombre del token" help="Para reconocerlo después, p. ej. «Claude Code de Lupe»" className="grow">
            <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Field>
          <button
            className="btn none"
            disabled={!nombre.trim()}
            onClick={async () => {
              const r = await run("crear_token_acceso", { nombre }, { exito: () => "Token creado. Cópialo ahora." });
              if (r) (setToken(r.token), setNombre(""));
            }}
          >
            Crear token
          </button>
        </div>
        {token && (
          <p className="badge warn" role="alert" style={{ alignSelf: "flex-start" }}>
            <Icon name="alert" /> Copia el comando ahora: el token no se vuelve a mostrar.
          </p>
        )}
        <span className="small muted">Claude Code</span>
        <span className="copy-row">
          <code className="block">{`claude mcp add --transport http kromo-cargo ${urlMcp} --header "Authorization: Bearer ${tk}"`}</code>
          <CopyButton texto={`claude mcp add --transport http kromo-cargo ${urlMcp} --header "Authorization: Bearer ${tk}"`} etiqueta="Copiar comando para Claude Code" />
        </span>
        <span className="small muted">Gemini CLI (~/.gemini/settings.json)</span>
        <span className="copy-row">
          <code className="block">{JSON.stringify({ mcpServers: { "kromo-cargo": { httpUrl: urlMcp, headers: { Authorization: `Bearer ${tk}` } } } })}</code>
          <CopyButton
            texto={JSON.stringify({ mcpServers: { "kromo-cargo": { httpUrl: urlMcp, headers: { Authorization: `Bearer ${tk}` } } } })}
            etiqueta="Copiar configuración para Gemini CLI"
          />
        </span>
      </div>
    </details>
  );
}

function IasConectadas() {
  const version = useVersion();
  const run = useAction();
  const accesos = useData<any[]>("listar_accesos", {}, [version]);
  return (
    <section className="card" aria-labelledby="conectadas-titulo">
      <div className="card-head">
        <h2 id="conectadas-titulo">IAs conectadas</h2>
        {accesos.data && <span className="badge">{accesos.data.length}</span>}
      </div>
      {accesos.data && !accesos.data.length && <EmptyState>Todavía no hay ninguna. Sigue los 3 pasos y aparecerá aquí.</EmptyState>}
      <ul className="lista">
        {accesos.data?.map((a) => (
          <li key={a.id} className="lista-item">
            <span className="avatar ia" aria-hidden><Icon name={a.tipo === "oauth" ? "ia" : "terminal"} /></span>
            <span className="lista-texto">
              <span className="strong">{a.nombre}</span>
              <span className="small muted">{a.tipo === "oauth" ? "Conector" : "Token"} · {a.ultimo_uso ? `usado ${haceCuanto(a.ultimo_uso)}` : "sin usar"}</span>
            </span>
            <button className="btn sm danger" onClick={() => run("revocar_acceso", { id: a.id }, { exito: () => "Acceso revocado" })} aria-label={`Desconectar ${a.nombre}`}>
              Desconectar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PruebaPedirle() {
  return (
    <section className="card" aria-labelledby="prueba-titulo">
      <div className="card-head">
        <h2 id="prueba-titulo">Prueba pedirle</h2>
      </div>
      <ul className="lista">
        {PREGUNTAS.map((p) => (
          <li key={p} className="lista-item">
            <span className="lista-texto">“{p}”</span>
            <CopyButton texto={p} etiqueta={`Copiar: ${p}`} className="btn ghost sm" />
          </li>
        ))}
      </ul>
      <p className="card-pad small muted" style={{ paddingTop: 0 }}>
        Los cambios grandes siempre te piden confirmación, y todo queda en el Historial.
      </p>
    </section>
  );
}

// ── Usuarios ────────────────────────────────────────────────────────

interface Usuario {
  id: number;
  nombre: string;
  usuario: string | null;
  rol: "dueno" | "empleado";
  activo: boolean;
  tiene_pin: boolean;
  pendiente: boolean;
}

const USUARIO_RE = /^[a-z0-9._-]{3,40}$/;
const limpiarUsuario = (v: string) => v.toLowerCase().replace(/\s/g, "");
const ROLES = [["empleado", "Empleado"], ["dueno", "Dueño"]] as const;
const ayudaRol = (rol: string) => (rol === "dueno" ? "Puede hacer todo, incluso cambiar precios en lote, importar y deshacer." : "Puede vender, registrar entradas y ver productos.");

function Usuarios() {
  const version = useVersion();
  const run = useAction();
  const usuarios = useData<Usuario[]>("listar_usuarios", {}, [version]);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const vacio = { nombre: "", usuario: "", contrasena: "", rol: "empleado" as Usuario["rol"], pin: "" };
  const [nuevo, setNuevo] = useState(vacio);
  const listo = nuevo.nombre.trim() && USUARIO_RE.test(nuevo.usuario) && nuevo.contrasena.length >= 8 && (!nuevo.pin || nuevo.pin.length >= 4);
  const detalle = (u: Usuario) =>
    [u.rol === "dueno" ? "Dueño" : "Empleado", u.usuario ? `@${u.usuario}` : "sin usuario", u.tiene_pin ? "con PIN de caja" : null, !u.activo ? "desactivado" : null]
      .filter(Boolean)
      .join(" · ");
  return (
    <div className="cols">
      <section className="card" aria-labelledby="usuarios-titulo">
        <div className="card-head">
          <h2 id="usuarios-titulo">Quién usa la app</h2>
          {usuarios.data && <span className="badge">{usuarios.data.length}</span>}
        </div>
        {usuarios.data && !usuarios.data.length && <EmptyState>Todavía no hay usuarios. Agrega el primero.</EmptyState>}
        <ul className="lista">
          {usuarios.data?.map((u) => (
            <li key={u.id} className="lista-item">
              <span className={`avatar ${u.activo ? "" : "off"}`} aria-hidden>{iniciales(u.nombre)}</span>
              <span className="lista-texto">
                <span className="strong">{u.nombre}</span>
                <span className="small muted">{detalle(u)}</span>
              </span>
              <button className="btn sm" onClick={() => setEditando(u)} aria-label={`Editar a ${u.nombre}`}>
                Editar
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="card" aria-labelledby="agregar-titulo">
        <div className="card-head">
          <h2 id="agregar-titulo">Agregar usuario</h2>
        </div>
        <form
          className="card-pad stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const datos = { ...nuevo, pin: nuevo.pin || undefined };
            if (await run("guardar_usuario", datos, { exito: () => "Usuario creado" })) setNuevo(vacio);
          }}
        >
          <Field label="Nombre">
            <input className="input" value={nuevo.nombre} maxLength={60} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
          </Field>
          <div className="grid2">
            <Field label="Usuario" help="Para entrar. Sin espacios.">
              <input className="input" value={nuevo.usuario} maxLength={40} autoCapitalize="none" spellCheck={false} autoComplete="off" onChange={(e) => setNuevo({ ...nuevo, usuario: limpiarUsuario(e.target.value) })} />
            </Field>
            <Field label="Contraseña" help="Al menos 8 caracteres.">
              <input className="input" type="password" value={nuevo.contrasena} maxLength={200} autoComplete="new-password" onChange={(e) => setNuevo({ ...nuevo, contrasena: e.target.value })} />
            </Field>
          </div>
          <div className="field">
            <span className="field-label" aria-hidden>Rol</span>
            <Segmented label="Rol" value={nuevo.rol} options={ROLES} onChange={(rol) => setNuevo({ ...nuevo, rol })} full />
            <span className="field-help">{ayudaRol(nuevo.rol)}</span>
          </div>
          <Field label="PIN de caja (opcional)" help="4 a 12 dígitos. Sirve para cambiar de cajero rápido en un equipo donde ya se entró con contraseña.">
            <input className="input" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={nuevo.pin} onChange={(e) => setNuevo({ ...nuevo, pin: e.target.value.replace(/\D/g, "") })} />
          </Field>
          <button className="btn primary" disabled={!listo}>
            <Icon name="plus" /> Agregar
          </button>
        </form>
      </section>
      {editando && <EditarUsuario u={editando} onClose={() => setEditando(null)} />}
    </div>
  );
}

function EditarUsuario({ u, onClose }: { u: Usuario; onClose: () => void }) {
  const run = useAction();
  const [f, setF] = useState({ nombre: u.nombre, usuario: u.usuario ?? "", contrasena: "", rol: u.rol, pin: "", quitar_pin: false, activo: u.activo });
  const [error, setError] = useState("");
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.nombre.trim()) return setError("Escribe el nombre.");
    if (f.usuario && !USUARIO_RE.test(f.usuario)) return setError("El usuario debe tener de 3 a 40 letras, números, punto o guion.");
    if (f.contrasena && f.contrasena.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (f.pin && f.pin.length < 4) return setError("El PIN debe tener de 4 a 12 dígitos.");
    const datos = {
      id: u.id,
      nombre: f.nombre.trim(),
      rol: f.rol,
      activo: f.activo,
      usuario: f.usuario || undefined,
      contrasena: f.contrasena || undefined,
      pin: f.pin || undefined,
      quitar_pin: f.quitar_pin && !f.pin,
    };
    const r = await run("guardar_usuario", datos, { exito: () => `Se guardaron los cambios de ${datos.nombre}` });
    if (!r) return;
    onClose();
    // Si te editaste a ti, tu sesión se cerró: la app vuelve a pedir acceso.
    sesionInfo().then((s) => !s.usuario && window.dispatchEvent(new Event("sesion-expirada")));
  };
  return (
    <Modal
      title={`Editar a ${u.nombre}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" form="editar-usuario" className="btn primary">Guardar</button>
        </>
      }
    >
      <form id="editar-usuario" className="stack" onSubmit={guardar}>
        <Field label="Nombre">
          <input className="input" value={f.nombre} maxLength={60} onChange={(e) => (setF({ ...f, nombre: e.target.value }), setError(""))} />
        </Field>
        <div className="grid2">
          <Field label="Usuario" help={u.usuario ? "Para entrar." : "Todavía no tiene: defínelo para que pueda entrar."}>
            <input className="input" value={f.usuario} maxLength={40} autoCapitalize="none" spellCheck={false} autoComplete="off" onChange={(e) => (setF({ ...f, usuario: limpiarUsuario(e.target.value) }), setError(""))} />
          </Field>
          <Field label="Contraseña nueva" help="Déjala vacía para no cambiarla.">
            <input className="input" type="password" value={f.contrasena} maxLength={200} autoComplete="new-password" onChange={(e) => (setF({ ...f, contrasena: e.target.value }), setError(""))} />
          </Field>
        </div>
        <div className="field">
          <span className="field-label" aria-hidden>Rol</span>
          <Segmented label="Rol" value={f.rol} options={ROLES} onChange={(rol) => setF({ ...f, rol })} full />
          <span className="field-help">{ayudaRol(f.rol)}</span>
        </div>
        <Field label={u.tiene_pin ? "PIN de caja nuevo" : "PIN de caja"} help={u.tiene_pin ? "Déjalo vacío para conservar el actual." : "Opcional, 4 a 12 dígitos."}>
          <input className="input" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={f.pin} onChange={(e) => (setF({ ...f, pin: e.target.value.replace(/\D/g, "") }), setError(""))} />
        </Field>
        {u.tiene_pin && (
          <label className="check">
            <input type="checkbox" checked={f.quitar_pin} disabled={!!f.pin} onChange={(e) => setF({ ...f, quitar_pin: e.target.checked })} />
            Quitar su PIN de caja
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />
          Puede entrar a la app (activo)
        </label>
        <p className="small muted">Si cambias su acceso, nombre o rol, se cierran sus sesiones abiertas.</p>
        <div role="alert" className="field-error">{error}</div>
      </form>
    </Modal>
  );
}

// ── Negocio ─────────────────────────────────────────────────────────

function Negocio({ cfg }: { cfg: any }) {
  const run = useAction();
  const [nombre, setNombre] = useState<string | null>(null);
  const servidor = cfg.modo === "servidor";
  const despliegue: Despliegue = cfg.despliegue;
  const respaldar = async () => {
    const r = await run("crear_respaldo", {}, { exito: () => "Respaldo listo. Se está descargando." });
    if (r?.url) location.assign(r.url);
  };
  return (
    <div className="cols">
      <div className="stack">
        <section className="card" aria-labelledby="negocio-titulo">
          <div className="card-head">
            <h2 id="negocio-titulo">Tu negocio</h2>
          </div>
          <form
            className="card-pad stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run("configurar_negocio", { nombre_negocio: nombre }, { exito: () => "Nombre actualizado. Recarga para verlo en el menú." })) setNombre(null);
            }}
          >
            <div className="row end">
              <Field label="Nombre del negocio" className="grow">
                <input className="input" value={nombre ?? cfg.nombre_negocio ?? ""} onChange={(e) => setNombre(e.target.value)} />
              </Field>
              <button className="btn none" disabled={nombre === null || !nombre.trim()}>Guardar</button>
            </div>
            {!servidor && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!cfg.requerir_pin}
                  onChange={(e) =>
                    run("configurar_negocio", { requerir_pin: e.target.checked }, { exito: () => (e.target.checked ? "Ahora se pide iniciar sesión al entrar" : "Ya no se pide iniciar sesión") })
                  }
                />
                Pedir usuario y contraseña al abrir la app
              </label>
            )}
          </form>
        </section>
        <section className="card" aria-labelledby="datos-titulo">
          <div className="card-head">
            <h2 id="datos-titulo">Tus datos</h2>
          </div>
          <div className="card-pad stack tight">
            <p className="muted">
              {despliegue === "railway"
                ? `Guardados en tu servidor de Railway (${String(cfg.base_de_datos).split(" (")[0]}).`
                : despliegue === "docker"
                  ? "Guardados en el volumen de Docker de esta computadora."
                  : servidor
                    ? `Guardados en el servidor de tu tienda (${String(cfg.base_de_datos).split(" (")[0]}).`
                    : "Todo vive en tu computadora, en un solo archivo. Nadie más lo ve."}
            </p>
            <code className="block">{cfg.carpeta_datos}</code>
            <div className="row">
              <button type="button" className="btn" onClick={respaldar}>
                <Icon name="download" /> Descargar respaldo
              </button>
            </div>
            <p className="small muted">Guarda el archivo en otro lugar (USB, Drive). Para restaurarlo: <code>kromo-cargo restaurar &lt;archivo&gt;</code>.</p>
            <details className="mas" hidden={servidor}>
              <summary>Diagnóstico</summary>
              <p className="muted small">En una terminal:</p>
              <span className="copy-row">
                <code className="block">kromo-cargo doctor</code>
                <CopyButton texto="kromo-cargo doctor" etiqueta="Copiar comando de diagnóstico" />
              </span>
            </details>
          </div>
        </section>
      </div>
      <div className="stack">
        <TarjetaNube despliegue={despliegue} />
        <AcercaDe cfg={cfg} />
      </div>
    </div>
  );
}

function AcercaDe({ cfg }: { cfg: any }) {
  const despliegue: Despliegue = cfg.despliegue;
  const [version, setVersion] = useState("");
  useEffect(() => {
    sesionInfo().then((s) => setVersion(s.version)).catch(() => {});
  }, []);
  const donde = { railway: "Railway", docker: "Docker", local: "esta computadora", gestionado: "servidor administrado por Aurora33" }[despliegue];
  return (
    <section className="card" aria-labelledby="acerca-titulo">
      <div className="card-head">
        <h2 id="acerca-titulo">Acerca de</h2>
      </div>
      <div className="card-pad stack tight">
        <p>
          <b>Kromo Cargo</b> {version && <span className="muted">v{version}</span>} · corriendo en {donde}
          {cfg.base_de_datos ? ` · ${String(cfg.base_de_datos).split(" (")[0]}` : ""}.
        </p>
        <p className="small muted">
          Gratis, por Aurora33. Licencia PolyForm Shield 1.0.0: úsalo y modifícalo libremente en tu negocio; no se permite venderlo como producto que compita.
        </p>
        {mostrarApoyo(despliegue) && (
          <div className="row">
            <a className="btn" href={KOFI_URL} target="_blank" rel="noopener noreferrer">
              <Icon name="heart" /> Apóyanos en Ko-fi<span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Dominio propio ──────────────────────────────────────────────────

function Dominio({ cfg }: { cfg: any }) {
  const run = useAction();
  const [dominio, setDominio] = useState<string>(cfg.dominio ?? "");
  const [estado, setEstado] = useState<{ responde: boolean | null } | null>(null);
  const despliegue: Despliegue = cfg.despliegue;
  const base = cfg.url_base ? new URL(cfg.url_base).host : location.host;
  const guardar = async (valor: string | null) => {
    const r = await run("configurar_dominio", { dominio: valor }, { exito: (x) => (x.dominio ? `Dominio guardado: ${x.dominio}` : "Se quitó el dominio propio") });
    if (r) (setEstado({ responde: r.responde }), setDominio(r.dominio ?? ""));
  };
  return (
    <div className="cols">
      <section className="card" aria-labelledby="dominio-titulo">
        <div className="card-head">
          <span className="ico"><Icon name="globe" /></span>
          <h2 id="dominio-titulo">Conecta tu dominio</h2>
        </div>
        <div className="card-pad stack">
          <p className="muted">
            Usa una dirección propia, como <b>inventario.tutienda.com</b>, en lugar de <b>{base}</b>. Es opcional: la app ya funciona con la dirección actual.
          </p>
          {despliegue === "railway" ? <PasosRailway base={base} /> : despliegue === "gestionado" ? <p>Aurora33 configura el dominio por ti. Escríbenos a hola@aurora33.app.</p> : <PasosDocker local={cfg.url_base ?? location.origin} />}
          <form
            className="row end"
            onSubmit={(e) => {
              e.preventDefault();
              guardar(dominio.trim() || null);
            }}
          >
            <Field label="Tu dominio" help="Solo el dominio, sin https://" className="grow">
              <input className="input" value={dominio} onChange={(e) => (setDominio(e.target.value), setEstado(null))} placeholder="inventario.tutienda.com" autoCapitalize="none" spellCheck={false} maxLength={253} />
            </Field>
            <button className="btn primary none" disabled={!dominio.trim() || dominio.trim() === cfg.dominio}>Guardar dominio</button>
          </form>
          {estado?.responde === true && (
            <p className="badge good nota" role="status" style={{ alignSelf: "flex-start" }}>
              <Icon name="check" /> Tu dominio ya responde. Abre la app desde https://{dominio}
            </p>
          )}
          {estado?.responde === false && (
            <p className="badge warn nota" role="status" style={{ alignSelf: "flex-start" }}>
              <Icon name="alert" /> Guardado, pero todavía no responde. Revisa los registros DNS; puede tardar unas horas.
            </p>
          )}
          {cfg.dominio && (
            <div className="row">
              <span className="small muted grow">Dominio actual: <b>{cfg.dominio}</b>. La dirección {base} sigue funcionando.</span>
              <button type="button" className="btn sm danger none" onClick={() => guardar(null)}>Quitar dominio</button>
            </div>
          )}
        </div>
      </section>
      <section className="card" aria-labelledby="dominio-ia-titulo">
        <div className="card-head">
          <h2 id="dominio-ia-titulo">Después de cambiarlo</h2>
        </div>
        <ul className="card-pad stack tight lista-simple">
          <li>La dirección para conectar Claude y ChatGPT cambia a <b>https://{cfg.dominio ?? "tu-dominio"}/mcp</b> (en la pestaña Conectar IA).</li>
          <li>Si ya tenías una IA conectada, desconéctala y vuelve a conectarla con la nueva dirección.</li>
          <li>Las personas que usan la app pueden seguir entrando por la dirección anterior.</li>
        </ul>
      </section>
    </div>
  );
}

function PasosRailway({ base }: { base: string }) {
  return (
    <ol className="pasos">
      <li>
        <span className="paso-titulo">Agrega el dominio en Railway</span>
        <span className="paso-detalle">
          En <b>railway.com</b> abre tu proyecto, el servicio de Kromo Cargo y ve a <b>Settings → Networking → Custom Domain</b>. Escribe tu dominio; si te pide puerto, elige <b>8080</b>.
        </span>
      </li>
      <li>
        <span className="paso-titulo">Crea los registros en tu proveedor</span>
        <span className="paso-detalle">
          Railway te muestra un registro <b>CNAME</b> (apunta a algo como {base.includes("railway.app") ? base : "xxxx.up.railway.app"}) y uno <b>TXT</b> de verificación. Agrégalos en
          donde compraste el dominio (GoDaddy, Namecheap, Cloudflare, Google…). Para un dominio sin subdominio (tutienda.com) tu proveedor debe aceptar CNAME en la raíz; si no,
          usa un subdominio como <b>inventario.tutienda.com</b>.
        </span>
      </li>
      <li>
        <span className="paso-titulo">Espera la verificación</span>
        <span className="paso-detalle">Puede tardar de minutos a unas horas. Railway pone el candado de https solo.</span>
      </li>
      <li>
        <span className="paso-titulo">Guárdalo aquí</span>
        <span className="paso-detalle">Escribe el dominio abajo y toca <b>Guardar dominio</b>. La app lo empieza a aceptar en ese momento.</span>
      </li>
    </ol>
  );
}

function PasosDocker({ local }: { local: string }) {
  const tunel = `cloudflared tunnel --url ${local}`;
  return (
    <ol className="pasos">
      <li>
        <span className="paso-titulo">Publica la app en internet</span>
        <span className="paso-detalle">
          Lo más simple es <b>Cloudflare Tunnel</b>: gratis y sin abrir puertos de tu módem. Para probar:
          <span className="copy-row" style={{ marginTop: "0.5rem" }}>
            <code className="block">{tunel}</code>
            <CopyButton texto={tunel} etiqueta="Copiar comando de Cloudflare Tunnel" />
          </span>
          Para un dominio fijo, crea un túnel con nombre en Cloudflare (Zero Trust → Networks → Tunnels) que apunte a <b>{local}</b>.
        </span>
      </li>
      <li>
        <span className="paso-titulo">Guárdalo aquí</span>
        <span className="paso-detalle">Escribe el dominio abajo y toca <b>Guardar dominio</b>. La app lo empieza a aceptar en ese momento.</span>
      </li>
    </ol>
  );
}
