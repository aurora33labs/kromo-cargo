/**
 * Modo de ejecución, leído de variables de entorno.
 *
 * Local (por defecto): la app escucha solo en 127.0.0.1 y es de quien usa la computadora.
 * Servidor (Railway u otro): se activa con KROMO_URL_PUBLICA o con RAILWAY_PUBLIC_DOMAIN.
 *   PORT                    puerto (Railway lo asigna)
 *   KROMO_PIN_INICIAL  PIN del primer dueño (6+ dígitos) si no hay usuarios
 *   KROMO_DUENO        nombre de ese primer dueño (por defecto "Dueño")
 *   KROMO_HOSTS        hosts extra permitidos, separados por coma
 *   DATABASE_URL            Postgres (si no, SQLite en la carpeta de datos / Volume)
 *   TZ                      zona horaria del negocio, p. ej. America/Mexico_City
 */
export interface Modo {
  servidor: boolean;
  urlPublica: string | null;
  hosts: string[];
  pinMinimo: number;
}

export function leerModo(env: Record<string, string | undefined> = process.env): Modo {
  const url = env.KROMO_URL_PUBLICA?.replace(/\/+$/, "") || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : null);
  const servidor = !!url || env.KROMO_MODO === "servidor";
  const hosts = ["localhost", "127.0.0.1", "[::1]"];
  if (url) hosts.push(new URL(url).hostname);
  for (const h of (env.KROMO_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) hosts.push(h);
  return { servidor, urlPublica: url, hosts, pinMinimo: servidor ? 6 : 4 };
}

/** Modo del proceso. Lo lee de variables de entorno y `startServer` lo fija al arrancar. */
export const modo: Modo = leerModo();

export function establecerModo(m: Modo) {
  Object.assign(modo, m);
}
