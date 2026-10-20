import { useCallback, useEffect, useState } from "react";

export type ExecResult =
  | { ok: true; resultado: any; historial_id?: number; requiere_confirmacion?: undefined }
  | { ok: true; requiere_confirmacion: true; mensaje: string; vista_previa: any; token_confirmacion: string }
  | { ok: false; error: string; detalles?: unknown };

// La sesión vive en una cookie HttpOnly que pone el servidor; el navegador la manda sola.
function headers(json = true): HeadersInit {
  const h: Record<string, string> = { "x-kromo": "1" };
  if (json) h["content-type"] = "application/json";
  return h;
}

async function handle(res: Response) {
  if (res.status === 401) window.dispatchEvent(new Event("sesion-expirada"));
  return res.json();
}

/** Ejecuta una acción. Regresa la respuesta cruda (incluye requiere_confirmacion). */
export async function call(name: string, input: unknown = {}): Promise<ExecResult> {
  try {
    const res = await fetch(`/api/acciones/${name}`, { method: "POST", headers: headers(), body: JSON.stringify(input) });
    return await handle(res);
  } catch {
    return { ok: false, error: "No hay conexión con la app. ¿Sigue abierta la terminal con `kromo-cargo serve`?" };
  }
}

/** Ejecuta una acción de lectura y regresa el resultado, o lanza el error. */
export async function get<T = any>(name: string, input: unknown = {}): Promise<T> {
  const r = await call(name, input);
  if (!r.ok) throw new Error(r.error);
  return (r as any).resultado as T;
}

export async function upload(file: File): Promise<{ ok: boolean; ruta?: string; error?: string }> {
  const fd = new FormData();
  fd.append("archivo", file);
  const res = await fetch("/api/subir", { method: "POST", headers: headers(false), body: fd });
  return handle(res);
}

export type Despliegue = "railway" | "docker" | "local" | "gestionado";
export interface SesionInfo {
  negocio: string;
  /** La app pide iniciar sesión (siempre en servidor; opcional en local). */
  requiere_pin: boolean;
  modo: "local" | "servidor";
  despliegue: Despliegue;
  /** Sin usuarios todavía: toca el primer registro ("Crea tu cuenta"). */
  registro: boolean;
  /** Este navegador ya es equipo de la tienda: se puede entrar con PIN de caja. */
  equipo: boolean;
  version: string;
  usuario: { nombre: string; rol: string; pendiente: boolean } | null;
}

export async function sesionInfo() {
  const res = await fetch("/api/sesion", { headers: headers(false) });
  return res.json() as Promise<SesionInfo>;
}

type Respuesta = { ok: boolean; error?: string };
const enviar = async (ruta: string, body: unknown): Promise<Respuesta> => {
  try {
    const res = await fetch(ruta, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    return (await res.json()) as Respuesta;
  } catch {
    return { ok: false, error: "No hay conexión con la app." };
  }
};

export const login = (usuario: string, contrasena: string) => enviar("/api/sesion", { usuario, contrasena });
export const loginPin = (pin: string) => enviar("/api/sesion/pin", { pin });
export const registrar = (datos: { negocio: string; nombre: string; usuario: string; contrasena: string; pin: string }) => enviar("/api/registro", datos);
export const definirCuenta = (usuario: string, contrasena: string) => enviar("/api/cuenta", { usuario, contrasena });

/** Cierra la sesión. `olvidar` también desvincula este equipo (ya no se podrá entrar con PIN). */
export async function logout(olvidar = false) {
  await fetch(`/api/sesion${olvidar ? "?olvidar=1" : ""}`, { method: "DELETE", headers: headers(false) });
}

export async function ultimoCambio() {
  const res = await fetch("/api/cambios", { headers: headers(false) });
  return res.json() as Promise<{ id: number; resumen: string | null; actor_tipo: string; actor_cliente: string | null } | null>;
}

/** Hook de datos: ejecuta una acción de lectura y la repite cuando cambian deps o la versión global. */
export function useData<T = any>(name: string, input: unknown, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(input);
  const load = useCallback(() => {
    let cancel = false;
    setLoading(true);
    get<T>(name, JSON.parse(key))
      .then((d) => !cancel && (setData(d), setError(null)))
      .catch((e) => !cancel && setError(e.message))
      .finally(() => !cancel && setLoading(false));
    return () => {
      cancel = true;
    };
  }, [name, key]);
  useEffect(load, [load, ...deps]);
  return { data, error, loading, reload: load };
}

export const money = (n: number | null | undefined) =>
  "$" + (n ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const qty = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 2 });

export function fechaLocal(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function haceCuanto(fecha: string) {
  const d = new Date(fecha.replace(" ", "T"));
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
