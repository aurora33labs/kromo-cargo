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

export async function sesionInfo() {
  const res = await fetch("/api/sesion", { headers: headers(false) });
  return res.json() as Promise<{ negocio: string; requiere_pin: boolean; modo: "local" | "servidor"; usuario: { nombre: string; rol: string } | null }>;
}

export async function login(pin: string) {
  const res = await fetch("/api/sesion", { method: "POST", headers: headers(), body: JSON.stringify({ pin }) });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

export async function logout() {
  await fetch("/api/sesion", { method: "DELETE", headers: headers(false) });
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
