import { useState } from "react";
import { haceCuanto, useData } from "../api.ts";
import { CopyButton, EmptyState, Field, Icon, Segmented, TabPanel, Tabs, iniciales, useAction } from "../components.tsx";
import { useVersion } from "../version.ts";

const PREGUNTAS = [
  "¿Qué se me va a acabar esta semana?",
  "¿Cuánto vendí hoy y qué fue lo que más salió?",
  "Llegaron 24 Coca-Cola 600 ml a $13.80 cada una.",
  "Sube 8% el precio de las bebidas, redondeado al peso.",
];

type Pestana = "ia" | "usuarios" | "negocio";
const PESTANAS = [
  ["ia", "Conectar IA", "ia"],
  ["usuarios", "Usuarios", "users"],
  ["negocio", "Negocio", "tienda"],
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

  return (
    <div className="page">
      <div className="page-head">
        <h1>Ajustes</h1>
      </div>
      <Tabs label="Secciones de ajustes" idBase="ajustes" value={pestana} onChange={cambiar} tabs={PESTANAS} />
      <TabPanel idBase="ajustes" id="ia" activo={pestana === "ia"}>
        {cfg.data && (cfg.data.modo === "servidor" ? <ConectarEnLinea urlMcp={cfg.data.url_mcp ?? `${location.origin}/mcp`} /> : <ConectarLocal />)}
      </TabPanel>
      <TabPanel idBase="ajustes" id="usuarios" activo={pestana === "usuarios"}>
        <Usuarios pinMinimo={cfg.data?.pin_minimo ?? 4} />
      </TabPanel>
      <TabPanel idBase="ajustes" id="negocio" activo={pestana === "negocio"}>
        {cfg.data && <Negocio cfg={cfg.data} />}
      </TabPanel>
    </div>
  );
}

// ── Conectar IA ─────────────────────────────────────────────────────

const PASOS: Record<"claude" | "chatgpt", (url: string) => { titulo: string; detalle: React.ReactNode }[]> = {
  claude: (url) => [
    { titulo: "Abre Claude", detalle: <>En la app o en claude.ai, entra a <b>Configuración → Conectores</b>.</> },
    { titulo: "Agrega el conector", detalle: <>Toca <b>Agregar conector personalizado</b>, ponle de nombre <b>Kromo Cargo</b> y pega esta dirección:<Direccion url={url} /></> },
    { titulo: "Autoriza con tu PIN", detalle: <>Se abre la página de tu tienda. Escribe tu <b>PIN de dueño</b> y toca <b>Permitir</b>. Listo.</> },
  ],
  chatgpt: (url) => [
    { titulo: "Abre ChatGPT", detalle: <>Entra a <b>Configuración → Apps y conectores → Avanzado</b> y activa el <b>Modo desarrollador</b>.</> },
    { titulo: "Crea el conector", detalle: <>Toca <b>Crear</b>, ponle de nombre <b>Kromo Cargo</b>, elige autenticación <b>OAuth</b> y pega esta dirección:<Direccion url={url} /></> },
    { titulo: "Autoriza con tu PIN", detalle: <>Se abre la página de tu tienda. Escribe tu <b>PIN de dueño</b> y toca <b>Permitir</b>. Listo.</> },
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
              <a className="btn" href="mailto:hola@aurora33.app?subject=Kromo%20Cargo%20en%20l%C3%ADnea" style={{ alignSelf: "flex-start" }}>
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

function Usuarios({ pinMinimo }: { pinMinimo: number }) {
  const version = useVersion();
  const run = useAction();
  const usuarios = useData<any[]>("listar_usuarios", {}, [version]);
  const [nuevo, setNuevo] = useState({ nombre: "", rol: "empleado", pin: "" });
  return (
    <div className="cols">
      <section className="card" aria-labelledby="usuarios-titulo">
        <div className="card-head">
          <h2 id="usuarios-titulo">Quién usa la app</h2>
          {usuarios.data && <span className="badge">{usuarios.data.length}</span>}
        </div>
        <ul className="lista">
          {usuarios.data?.map((u) => (
            <li key={u.id} className="lista-item">
              <span className={`avatar ${u.activo ? "" : "off"}`} aria-hidden>{iniciales(u.nombre)}</span>
              <span className="lista-texto">
                <span className="strong">{u.nombre}</span>
                <span className="small muted">{u.rol === "dueno" ? "Dueño" : "Empleado"}{!u.activo && " · desactivado"}</span>
              </span>
              <button
                className="btn sm"
                onClick={() => run("guardar_usuario", { id: u.id, nombre: u.nombre, rol: u.rol, activo: !u.activo }, { exito: () => "Usuario actualizado" })}
                aria-label={`${u.activo ? "Desactivar" : "Activar"} a ${u.nombre}`}
              >
                {u.activo ? "Desactivar" : "Activar"}
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
            if (await run("guardar_usuario", nuevo, { exito: () => "Usuario creado" })) setNuevo({ nombre: "", rol: "empleado", pin: "" });
          }}
        >
          <Field label="Nombre">
            <input className="input" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
          </Field>
          <div className="field">
            <span className="field-label" aria-hidden>Rol</span>
            <Segmented label="Rol" value={nuevo.rol as "empleado" | "dueno"} options={[["empleado", "Empleado"], ["dueno", "Dueño"]] as const} onChange={(rol) => setNuevo({ ...nuevo, rol })} full />
            <span className="field-help">
              {nuevo.rol === "dueno" ? "Puede hacer todo, incluso cambiar precios en lote, importar y deshacer." : "Puede vender, registrar entradas y ver productos."}
            </span>
          </div>
          <Field label="PIN" help={`De ${pinMinimo} a 12 dígitos. Con él entra a la app.`}>
            <input className="input" inputMode="numeric" autoComplete="new-password" maxLength={12} value={nuevo.pin} onChange={(e) => setNuevo({ ...nuevo, pin: e.target.value.replace(/\D/g, "") })} />
          </Field>
          <button className="btn primary" disabled={!nuevo.nombre.trim() || nuevo.pin.length < pinMinimo}>
            <Icon name="plus" /> Agregar
          </button>
        </form>
      </section>
    </div>
  );
}

// ── Negocio ─────────────────────────────────────────────────────────

function Negocio({ cfg }: { cfg: any }) {
  const run = useAction();
  const [nombre, setNombre] = useState<string | null>(null);
  const servidor = cfg.modo === "servidor";
  return (
    <div className="cols">
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
                onChange={(e) => run("configurar_negocio", { requerir_pin: e.target.checked }, { exito: () => (e.target.checked ? "Ahora se pide PIN al entrar" : "Ya no se pide PIN") })}
              />
              Pedir PIN al abrir la app
            </label>
          )}
        </form>
      </section>
      <section className="card" aria-labelledby="datos-titulo">
        <div className="card-head">
          <h2 id="datos-titulo">Tus datos</h2>
        </div>
        <div className="card-pad stack tight">
          <p className="muted">{servidor ? `Guardados en el servidor de tu tienda (${String(cfg.base_de_datos).split(" (")[0]}).` : "Todo vive en tu computadora, en un solo archivo. Nadie más lo ve."}</p>
          <code className="block">{cfg.carpeta_datos}</code>
          <details className="mas" hidden={servidor}>
            <summary>Respaldo y diagnóstico</summary>
            <p className="muted small">En una terminal:</p>
            <span className="copy-row">
              <code className="block">kromo-cargo respaldo</code>
              <CopyButton texto="kromo-cargo respaldo" etiqueta="Copiar comando de respaldo" />
            </span>
            <span className="copy-row" style={{ marginTop: "0.5rem" }}>
              <code className="block">kromo-cargo doctor</code>
              <CopyButton texto="kromo-cargo doctor" etiqueta="Copiar comando de diagnóstico" />
            </span>
          </details>
        </div>
      </section>
    </div>
  );
}
