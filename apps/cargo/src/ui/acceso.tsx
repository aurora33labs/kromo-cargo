import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { definirCuenta, login, loginPin, registrar } from "./api.ts";
import { Field, Logo } from "./components.tsx";

const USUARIO_RE = /^[a-z0-9._-]{3,40}$/;
const limpiarUsuario = (v: string) => v.toLowerCase().replace(/\s/g, "");

/** Marco común de las pantallas de acceso: logo, título y formulario centrado. */
function Tarjeta({ titulo, sub, onSubmit, children, ancho }: { titulo: string; sub?: ReactNode; onSubmit: (e: FormEvent) => void; children: ReactNode; ancho?: boolean }) {
  useEffect(() => {
    document.title = `${titulo} · Kromo Cargo`;
  }, [titulo]);
  return (
    <main className="login">
      <form className={`card acceso ${ancho ? "ancho" : ""}`} onSubmit={onSubmit} aria-labelledby="acceso-titulo" noValidate>
        <Logo className="brand-logo" />
        <div>
          <h1 id="acceso-titulo">{titulo}</h1>
          {sub && <p className="muted">{sub}</p>}
        </div>
        {children}
      </form>
    </main>
  );
}

function useEnvio() {
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const enviar = async (fn: () => Promise<{ ok: boolean; error?: string }>, onOk: () => void, fallback: string) => {
    setEnviando(true);
    const r = await fn();
    setEnviando(false);
    if (r.ok) onOk();
    else setError(r.error ?? fallback);
    return r.ok;
  };
  return { error, setError, enviando, enviar };
}

const Error = ({ error }: { error: string }) => (
  <div role="alert" className="field-error">
    {error}
  </div>
);

/** Primer registro: quien despliega la app crea la cuenta del dueño. */
export function Registro({ negocioInicial, onOk }: { negocioInicial: string; onOk: () => void }) {
  const [f, setF] = useState({ negocio: negocioInicial === "Mi tienda" ? "" : negocioInicial, nombre: "", usuario: "", contrasena: "", confirmar: "", pin: "" });
  const { error, setError, enviando, enviar } = useEnvio();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = k === "usuario" ? limpiarUsuario(e.target.value) : k === "pin" ? e.target.value.replace(/\D/g, "") : e.target.value;
    setF({ ...f, [k]: v });
    setError("");
  };
  const errores = {
    usuario: f.usuario && !USUARIO_RE.test(f.usuario) ? "De 3 a 40 letras, números, punto o guion." : undefined,
    contrasena: f.contrasena && f.contrasena.length < 8 ? "Al menos 8 caracteres." : undefined,
    confirmar: f.confirmar && f.confirmar !== f.contrasena ? "No coincide con la contraseña." : undefined,
    pin: f.pin && f.pin.length < 4 ? "De 4 a 12 dígitos." : undefined,
  };
  const listo = f.nombre.trim() && USUARIO_RE.test(f.usuario) && f.contrasena.length >= 8 && f.confirmar === f.contrasena && (!f.pin || f.pin.length >= 4);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!listo) return setError("Revisa los campos marcados.");
    enviar(() => registrar({ negocio: f.negocio.trim(), nombre: f.nombre.trim(), usuario: f.usuario, contrasena: f.contrasena, pin: f.pin }), onOk, "No se pudo crear la cuenta");
  };
  return (
    <Tarjeta titulo="Crea tu cuenta" sub="Eres la primera persona en entrar: esta cuenta será la del dueño." onSubmit={submit} ancho>
      <Field label="Nombre del negocio" help="Opcional. Lo puedes cambiar en Ajustes.">
        <input className="input" value={f.negocio} onChange={set("negocio")} maxLength={120} autoComplete="organization" placeholder="Abarrotes Lupita" />
      </Field>
      <Field label="Tu nombre">
        <input className="input" value={f.nombre} onChange={set("nombre")} maxLength={60} autoComplete="name" required autoFocus />
      </Field>
      <Field label="Usuario" help="Con él entras. Sin espacios, por ejemplo lupita." error={errores.usuario}>
        <input className="input" value={f.usuario} onChange={set("usuario")} maxLength={40} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
      </Field>
      <div className="grid2">
        <Field label="Contraseña" help="Al menos 8 caracteres." error={errores.contrasena}>
          <input className="input" type="password" value={f.contrasena} onChange={set("contrasena")} maxLength={200} autoComplete="new-password" required />
        </Field>
        <Field label="Repite la contraseña" error={errores.confirmar}>
          <input className="input" type="password" value={f.confirmar} onChange={set("confirmar")} maxLength={200} autoComplete="new-password" required />
        </Field>
      </div>
      <Field label="PIN de caja (opcional)" help="4 a 12 dígitos para cambiar de cajero rápido en esta computadora." error={errores.pin}>
        <input className="input" type="password" inputMode="numeric" value={f.pin} onChange={set("pin")} maxLength={12} autoComplete="off" />
      </Field>
      <Error error={error} />
      <button className="btn primary lg" disabled={enviando}>{enviando ? "Creando…" : "Crear cuenta y entrar"}</button>
    </Tarjeta>
  );
}

/** Entrar con usuario y contraseña. */
export function Login({ negocio, conPin, onPin, onOk }: { negocio: string; conPin: boolean; onPin: () => void; onOk: () => void }) {
  const [usuario, setUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const { error, setError, enviando, enviar } = useEnvio();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!usuario || !contrasena) return setError("Escribe tu usuario y tu contraseña.");
    const ok = await enviar(() => login(usuario, contrasena), onOk, "Usuario o contraseña incorrectos");
    if (!ok) setContrasena("");
  };
  return (
    <Tarjeta titulo={negocio} sub="Kromo Cargo" onSubmit={submit}>
      <Field label="Usuario">
        <input className="input" value={usuario} onChange={(e) => (setUsuario(limpiarUsuario(e.target.value)), setError(""))} maxLength={40} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus />
      </Field>
      <Field label="Contraseña">
        <input className="input" type="password" value={contrasena} onChange={(e) => (setContrasena(e.target.value), setError(""))} maxLength={200} autoComplete="current-password" />
      </Field>
      <Error error={error} />
      <button className="btn primary lg" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
      {conPin && (
        <button type="button" className="btn ghost" onClick={onPin}>
          Entrar con PIN de caja
        </button>
      )}
    </Tarjeta>
  );
}

/** Cambio de cajero: en un equipo de la tienda se entra con el PIN. */
export function AccesoPin({ negocio, onContrasena, onOk }: { negocio: string; onContrasena: () => void; onOk: () => void }) {
  const [pin, setPin] = useState("");
  const { error, setError, enviando, enviar } = useEnvio();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await enviar(() => loginPin(pin), onOk, "PIN incorrecto");
    if (!ok) setPin("");
  };
  return (
    <Tarjeta titulo={negocio} sub="¿Quién cobra? Escribe tu PIN de caja." onSubmit={submit}>
      <Field label="PIN de caja">
        <input
          className="input pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={(e) => (setPin(e.target.value.replace(/\D/g, "")), setError(""))}
          maxLength={12}
        />
      </Field>
      <Error error={error} />
      <button className="btn primary lg" disabled={pin.length < 4 || enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
      <button type="button" className="btn ghost" onClick={onContrasena}>
        Entrar con usuario y contraseña
      </button>
    </Tarjeta>
  );
}

/** Usuario de una versión anterior (solo PIN): define su usuario y contraseña una vez. */
export function DefinirCuenta({ nombre, onOk }: { nombre: string; onOk: () => void }) {
  const [usuario, setUsuario] = useState(limpiarUsuario(nombre.normalize("NFD").replace(/[̀-ͯ]/g, "")).replace(/[^a-z0-9._-]/g, ""));
  const [contrasena, setContrasena] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const { error, setError, enviando, enviar } = useEnvio();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!USUARIO_RE.test(usuario)) return setError("El usuario debe tener de 3 a 40 letras, números, punto o guion.");
    if (contrasena.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (contrasena !== confirmar) return setError("Las contraseñas no coinciden.");
    enviar(() => definirCuenta(usuario, contrasena), onOk, "No se pudo guardar");
  };
  return (
    <Tarjeta titulo={`Hola, ${nombre}`} sub="Ahora se entra con usuario y contraseña. Defínelos una sola vez; tu PIN seguirá sirviendo para cambiar de cajero." onSubmit={submit}>
      <Field label="Usuario" help="Sin espacios.">
        <input className="input" value={usuario} onChange={(e) => (setUsuario(limpiarUsuario(e.target.value)), setError(""))} maxLength={40} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus />
      </Field>
      <Field label="Contraseña nueva" help="Al menos 8 caracteres.">
        <input className="input" type="password" value={contrasena} onChange={(e) => (setContrasena(e.target.value), setError(""))} maxLength={200} autoComplete="new-password" />
      </Field>
      <Field label="Repite la contraseña">
        <input className="input" type="password" value={confirmar} onChange={(e) => (setConfirmar(e.target.value), setError(""))} maxLength={200} autoComplete="new-password" />
      </Field>
      <Error error={error} />
      <button className="btn primary lg" disabled={enviando}>{enviando ? "Guardando…" : "Guardar y entrar"}</button>
    </Tarjeta>
  );
}
