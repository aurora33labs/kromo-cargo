import { useState } from "react";
import { useData } from "../api.ts";
import { Icon, useAction } from "../components.tsx";
import { useVersion } from "../version.ts";

const PREGUNTAS = [
  "¿Qué se me va a acabar esta semana? Arma el pedido por proveedor.",
  "¿Cuánto vendí hoy y qué fue lo que más salió?",
  "Aquí hay 5 fotos de productos nuevos: dalos de alta y genera sus etiquetas.",
  "Sube 8% el precio de todas las bebidas, redondeado al peso.",
  "Llegaron 24 Coca-Cola 600 ml a $13.80 cada una.",
  "¿Qué productos llevan un mes sin venderse y cuánto dinero tengo ahí?",
];

function Copiable({ texto }: { texto: string }) {
  return (
    <div className="row" style={{ flexWrap: "nowrap" }}>
      <code className="block" style={{ flex: 1 }}>{texto}</code>
      <button className="btn sm" onClick={() => navigator.clipboard?.writeText(texto)}>Copiar</button>
    </div>
  );
}

/** Conexión de IAs por internet (solo en modo servidor). */
function IaRemota({ urlMcp }: { urlMcp: string }) {
  const version = useVersion();
  const run = useAction();
  const accesos = useData<any[]>("listar_accesos", {}, [version]);
  const [nombre, setNombre] = useState("");
  const [nuevo, setNuevo] = useState<string | null>(null);
  const tk = nuevo ?? "<TOKEN>";
  return (
    <div className="card">
      <div className="card-head">
        <span style={{ width: 18, height: 18, display: "inline-flex", color: "var(--ia)" }}><Icon name="ia" /></span>
        <h2>Conectar una IA por internet</h2>
      </div>
      <div className="card-pad stack" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 6 }}>
          <h3>Dirección del MCP</h3>
          <Copiable texto={urlMcp} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <h3>Claude (web, escritorio y celular) o ChatGPT</h3>
          <ol className="steps" style={{ margin: 0, padding: 0 }}>
            <li><b>Claude:</b> Configuración → Conectores → Agregar conector personalizado. <b>ChatGPT:</b> Configuración → Apps y conectores → Modo desarrollador → Crear.</li>
            <li>Pega la dirección del MCP. Al conectar se abre una página de esta tienda: entra con el PIN de un dueño y presiona Permitir.</li>
          </ol>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <h3>Claude Code, Gemini CLI u otro agente (con token)</h3>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input className="input" placeholder="Nombre del token, p. ej. Claude Code de Lupe" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            <button
              className="btn primary"
              disabled={!nombre.trim()}
              onClick={async () => {
                const r = await run("crear_token_acceso", { nombre }, { exito: () => "Token creado. Cópialo ahora." });
                if (r) (setNuevo(r.token), setNombre(""));
              }}
            >
              Crear token
            </button>
          </div>
          {nuevo && <div className="badge warn" style={{ justifySelf: "start" }}>Copia el token: no se vuelve a mostrar.</div>}
          <span className="small muted">Claude Code:</span>
          <Copiable texto={`claude mcp add --transport http kromo-cargo ${urlMcp} --header "Authorization: Bearer ${tk}"`} />
          <span className="small muted">Gemini CLI (~/.gemini/settings.json):</span>
          <Copiable texto={JSON.stringify({ mcpServers: { "kromo-cargo": { httpUrl: urlMcp, headers: { Authorization: `Bearer ${tk}` } } } })} />
        </div>
        <div>
          <h3 style={{ marginBottom: 6 }}>Accesos activos</h3>
          <table className="table">
            <tbody>
              {accesos.data?.map((a) => (
                <tr key={a.id}>
                  <td><span className={`badge ${a.tipo === "oauth" ? "ia" : ""}`}>{a.tipo === "oauth" ? "Conector" : "Token"}</span></td>
                  <td style={{ fontWeight: 600 }}>{a.nombre}</td>
                  <td className="small muted">{a.ultimo_uso ? `usado ${a.ultimo_uso.slice(0, 16)}` : "sin usar"}</td>
                  <td className="r">
                    <button className="btn sm danger" onClick={() => run("revocar_acceso", { id: a.id }, { exito: () => "Acceso revocado" })}>Revocar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {accesos.data && !accesos.data.length && <div className="muted small">Ninguna IA conectada todavía.</div>}
        </div>
      </div>
    </div>
  );
}

export function Ajustes() {
  const version = useVersion();
  const run = useAction();
  const cfg = useData<any>("ver_configuracion", {}, [version]);
  const servidor = cfg.data?.modo === "servidor";
  const usuarios = useData<any[]>("listar_usuarios", {}, [version]);
  const [nombre, setNombre] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({ nombre: "", rol: "empleado", pin: "" });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Ajustes y conexión con IA</h1>
      </div>
      <div className="cols">
        <div className="stack">
          {servidor && cfg.data?.url_mcp && <IaRemota urlMcp={cfg.data.url_mcp} />}
          <div className="card" style={servidor ? { display: "none" } : undefined}>
            <div className="card-head">
              <span style={{ width: 18, height: 18, display: "inline-flex", color: "var(--ia)" }}><Icon name="ia" /></span>
              <h2>Tu IA ya puede operar este inventario</h2>
            </div>
            <div className="card-pad stack" style={{ gap: 14 }}>
              <ol className="steps" style={{ margin: 0, padding: 0 }}>
                <li>
                  Si instalaste con el prompt, ya está conectado. Si no, en una terminal corre:
                  <code className="block" style={{ marginTop: 6 }}>kromo-cargo conectar</code>
                  <span className="small muted">Lo registra en Claude Code, Codex CLI, Gemini CLI y Claude Desktop (los que tengas).</span>
                </li>
                <li>Abre tu IA y pregúntale lo que necesites. Todo lo que haga aparece aquí en vivo y queda en el Historial.</li>
                <li>Los cambios grandes (precios en lote, importaciones, ajustes fuertes) siempre te piden confirmación primero.</li>
              </ol>
              <div>
                <h3 style={{ marginBottom: 8 }}>Prueba pedirle</h3>
                <div className="stack" style={{ gap: 6 }}>
                  {PREGUNTAS.map((p) => (
                    <div key={p} className="row" style={{ flexWrap: "nowrap", background: "var(--surface-2)", borderRadius: 8, padding: "8px 10px" }}>
                      <span style={{ flex: 1 }}>“{p}”</span>
                      <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(p)}>Copiar</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Usuarios</h2></div>
            <table className="table">
              <tbody>
                {usuarios.data?.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.nombre}</td>
                    <td><span className={`badge ${u.rol === "dueno" ? "accent" : ""}`}>{u.rol === "dueno" ? "Dueño" : "Empleado"}</span></td>
                    <td className="r">
                      <button className="btn sm" onClick={() => run("guardar_usuario", { id: u.id, nombre: u.nombre, rol: u.rol, activo: !u.activo }, { exito: () => "Usuario actualizado" })}>
                        {u.activo ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="card-pad row" style={{ borderTop: "1px solid var(--border)", alignItems: "flex-end" }}>
              <label className="field" style={{ flex: 2, minWidth: 140 }}>
                <span>Nombre</span>
                <input className="input" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 120 }}>
                <span>Rol</span>
                <select className="select" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
                  <option value="empleado">Empleado</option>
                  <option value="dueno">Dueño</option>
                </select>
              </label>
              <label className="field" style={{ flex: 1, minWidth: 100 }}>
                <span>PIN</span>
                <input className="input" inputMode="numeric" maxLength={12} placeholder={`${cfg.data?.pin_minimo ?? 4}+ dígitos`} value={nuevo.pin} onChange={(e) => setNuevo({ ...nuevo, pin: e.target.value.replace(/\D/g, "") })} />
              </label>
              <button
                className="btn primary"
                disabled={!nuevo.nombre || nuevo.pin.length < (cfg.data?.pin_minimo ?? 4)}
                onClick={async () => (await run("guardar_usuario", nuevo, { exito: () => "Usuario creado" })) && setNuevo({ nombre: "", rol: "empleado", pin: "" })}
              >
                Agregar
              </button>
            </div>
            <div className="card-pad small muted" style={{ paddingTop: 0 }}>
              Los empleados pueden vender, registrar entradas y ver productos. Cambios de precio en lote, importaciones y deshacer son solo para dueños.
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card card-pad stack" style={{ gap: 12 }}>
            <h2>Negocio</h2>
            <label className="field">
              <span>Nombre</span>
              <input className="input" value={nombre ?? cfg.data?.nombre_negocio ?? ""} onChange={(e) => setNombre(e.target.value)} />
            </label>
            <button
              className="btn"
              disabled={nombre === null || !nombre.trim()}
              onClick={async () => (await run("configurar_negocio", { nombre_negocio: nombre }, { exito: () => "Nombre actualizado. Recarga para verlo en el menú." })) && setNombre(null)}
            >
              Guardar nombre
            </button>
            <label className="check" style={servidor ? { display: "none" } : undefined}>
              <input
                type="checkbox"
                checked={!!cfg.data?.requerir_pin}
                onChange={(e) => run("configurar_negocio", { requerir_pin: e.target.checked }, { exito: () => (e.target.checked ? "Ahora se pide PIN al entrar" : "Ya no se pide PIN") })}
              />
              Pedir PIN al abrir la app
            </label>
          </div>
          <div className="card card-pad stack" style={{ gap: 8 }}>
            <h2>Tus datos</h2>
            <p className="muted small" style={{ margin: 0 }}>
              {servidor ? `En el servidor · ${cfg.data?.base_de_datos}.` : "Todo vive en tu computadora, en un solo archivo. Nadie más lo ve."}
            </p>
            <code className="block">{cfg.data?.carpeta_datos}</code>
            <p className="muted small" style={{ margin: 0 }}>
              Respaldo: <span className="mono">kromo-cargo respaldo</span> · Diagnóstico: <span className="mono">kromo-cargo doctor</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
