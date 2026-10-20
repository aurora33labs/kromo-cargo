import { existsSync } from "node:fs";

/**
 * Modo de ejecución, leído de variables de entorno.
 *
 * Local (por defecto): la app escucha solo en 127.0.0.1 y es de quien usa la computadora.
 * Servidor (Railway, Docker u otro): se activa con KROMO_URL_PUBLICA, RAILWAY_PUBLIC_DOMAIN o KROMO_MODO=servidor.
 * El primer dueño se registra desde la UI (usuario y contraseña); no hay variables obligatorias.
 *   PORT               puerto (Railway lo asigna)
 *   KROMO_PIN_INICIAL  opcional: crea un primer dueño "dueno" con esta contraseña provisional
 *   KROMO_DUENO        nombre de ese primer dueño (por defecto "Dueño")
 *   KROMO_HOSTS        hosts extra permitidos, separados por coma
 *   KROMO_DESPLIEGUE   railway | docker | local | gestionado (si no, se detecta)
 *   DATABASE_URL       Postgres (si no, SQLite en la carpeta de datos / Volume)
 *   TZ                 zona horaria del negocio, p. ej. America/Mexico_City
 */
export type Despliegue = "railway" | "docker" | "local" | "gestionado";

export interface Modo {
  servidor: boolean;
  urlPublica: string | null;
  /** URL pública sin dominio propio (variables de entorno / dominio de Railway). */
  urlBase: string | null;
  hosts: string[];
  pinMinimo: number;
  despliegue: Despliegue;
  /** Dominio propio configurado desde la UI (si hay). */
  dominio?: string | null;
}

/** Dónde corre la app: decide textos, instrucciones y la promoción de la versión en la nube. */
export function detectarDespliegue(env: Record<string, string | undefined> = process.env, enDocker = existsSync("/.dockerenv")): Despliegue {
  const forzado = env.KROMO_DESPLIEGUE?.trim().toLowerCase();
  if (forzado === "railway" || forzado === "docker" || forzado === "local" || forzado === "gestionado") return forzado;
  if (env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_PUBLIC_DOMAIN) return "railway";
  if (enDocker || env.KROMO_EN_DOCKER === "1") return "docker";
  return "local";
}

export function leerModo(env: Record<string, string | undefined> = process.env, enDocker?: boolean): Modo {
  const url = env.KROMO_URL_PUBLICA?.replace(/\/+$/, "") || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : null);
  const servidor = !!url || env.KROMO_MODO === "servidor";
  const hosts = ["localhost", "127.0.0.1", "[::1]"];
  if (url) hosts.push(new URL(url).hostname);
  for (const h of (env.KROMO_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) hosts.push(h);
  return { servidor, urlPublica: url, urlBase: url, hosts, pinMinimo: 4, despliegue: detectarDespliegue(env, enDocker) };
}

/** Modo del proceso. Lo lee de variables de entorno y `startServer` lo fija al arrancar. */
export const modo: Modo = leerModo();

export function establecerModo(m: Modo) {
  Object.assign(modo, { dominio: null }, m, { hosts: [...m.hosts] });
}

/** Normaliza lo que escribe la persona ("https://Tienda.com/" → "tienda.com"). Regresa null si no es un dominio válido. */
export function normalizarDominio(entrada: string): string | null {
  const d = entrada.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!d) return null;
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) return null;
  return d;
}

/** Aplica un dominio propio: se acepta como host y pasa a ser la URL pública (OAuth, cookies, enlaces). */
export function establecerDominio(dominio: string | null) {
  if (dominio && !modo.hosts.includes(dominio)) modo.hosts.push(dominio);
  modo.dominio = dominio;
  modo.urlPublica = dominio ? `https://${dominio}` : modo.urlBase;
}
