import {
  Auth,
  CSRF_HEADER,
  createApiHandler,
  createMcpHttpHandler,
  guardRequest,
  json,
  type Actor,
  type Identidad,
} from "@kromo/core";
import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { VERSION, mcpOptions, type App } from "./app.ts";
import { establecerModo, type Modo } from "./config.ts";
import { ahora, getConfig } from "./lib.ts";
import ui from "./ui/index.html";
import icono192 from "./ui/assets/icon-192.png" with { type: "file" };
import icono512 from "./ui/assets/icon-512.png" with { type: "file" };
import logoSvg from "./ui/assets/logo.svg" with { type: "text" };

const ARCHIVOS = ["fotos", "etiquetas", "exportaciones"];
const SUBIDAS_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".csv", ".txt", ".tsv", ".xlsx"];
const FIRMA_TTL_S = 60 * 60;

// Manifest de la app instalable (PWA). Va fuera del HTML porque el bundler de Bun no reescribe las rutas de sus íconos.
const MANIFEST = JSON.stringify({
  name: "Kromo Cargo",
  short_name: "Cargo",
  description: "Inventario y venta rápida para tu tienda, operado por personas y por IA.",
  lang: "es-MX",
  start_url: "/",
  display: "standalone",
  background_color: "#070709",
  theme_color: "#070709",
  icons: [
    { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
  ],
});

export const isCompiled = import.meta.path.includes("$bunfs") || import.meta.path.includes("~BUN");

export interface ServeOptions {
  port: number;
  open: boolean;
  modo: Modo;
}

/** En modo servidor, crea el primer dueño con KROMO_PIN_INICIAL y deja el PIN obligatorio. */
export async function prepararServidor(app: App, modo: Modo, env = process.env) {
  if (!modo.servidor) return;
  const n = Number((await app.db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM usuarios WHERE activo = 1"))?.n ?? 0);
  if (n === 0) {
    const pin = env.KROMO_PIN_INICIAL ?? "";
    if (!/^\d{6,12}$/.test(pin)) {
      throw new Error(
        "Modo servidor sin usuarios: define KROMO_PIN_INICIAL (6 a 12 dígitos) para crear al primer dueño. " +
          "En Railway, agrégala en Variables.",
      );
    }
    await app.db.run("INSERT INTO usuarios (nombre, rol, pin_hash, creado_en) VALUES (?, 'dueno', ?, ?)", [
      env.KROMO_DUENO || "Dueño",
      await Bun.password.hash(pin),
      ahora(),
    ]);
  }
  await app.db.run("UPDATE configuracion SET valor = '1' WHERE clave = 'requerir_pin'");
}

/** Secreto para firmar enlaces de descarga. Se genera una vez y se guarda en la base. */
async function secretoArchivos(app: App): Promise<string> {
  if (process.env.KROMO_SECRETO) return process.env.KROMO_SECRETO;
  const row = await app.db.get("SELECT valor FROM configuracion WHERE clave = 'secreto_archivos'");
  if (row) return row.valor;
  const s = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  await app.db.run("INSERT INTO configuracion (clave, valor) VALUES ('secreto_archivos', ?) ON CONFLICT (clave) DO NOTHING", [s]);
  return (await app.db.get("SELECT valor FROM configuracion WHERE clave = 'secreto_archivos'"))!.valor;
}

export async function startServer(app: App, opts: ServeOptions) {
  const { modo } = opts;
  establecerModo(modo);
  await prepararServidor(app, modo);
  const secreto = await secretoArchivos(app);
  const hmac = (s: string) => new Bun.CryptoHasher("sha256", secreto).update(s).digest("hex").slice(0, 32);
  const firmar = (rel: string) => {
    const exp = Math.floor(Date.now() / 1000) + FIRMA_TTL_S;
    return `${rel}?f=${exp}.${hmac(`${rel}:${exp}`)}`;
  };
  const firmaValida = (rel: string, f: string | null) => {
    const [exp, sig] = (f ?? "").split(".");
    if (!exp || !sig || !(Number(exp) > Date.now() / 1000)) return false;
    const esperada = Buffer.from(hmac(`${rel}:${exp}`));
    const recibida = Buffer.from(sig);
    return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
  };

  let auth!: Auth;
  let ipDe: (req: Request) => string = () => "local";

  const verificarPin = async (pin: string): Promise<Identidad | null> => {
    if (!/^\d{4,12}$/.test(pin)) return null;
    const usuarios = await app.db.all("SELECT nombre, rol, pin_hash FROM usuarios WHERE activo = 1");
    for (const u of usuarios) if (await Bun.password.verify(pin, u.pin_hash)) return { usuario: u.nombre, rol: u.rol };
    return null;
  };

  const getActor = async (req: Request): Promise<Actor | Response> => {
    if (!modo.servidor && (await getConfig(app.db)).requerir_pin !== "1") return { tipo: "humano", cliente: "ui", usuario: "Dueño", rol: "dueno" };
    return (await auth.leerSesion(req)) ?? json({ ok: false, error: "Sesión expirada. Ingresa tu PIN.", sesion: false }, 401);
  };

  const api = createApiHandler(app.registry, { getActor, allowedHosts: modo.hosts });
  let mcpHttp: ((req: Request) => Promise<Response>) | null = null;

  const handler = async (req: Request): Promise<Response> => conCabeceras(await manejar(req));

  const manejar = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/manifest.webmanifest") return new Response(MANIFEST, { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=86400" } });
    if (p === "/icons/192.png" || p === "/icons/512.png") {
      return new Response(Bun.file(p === "/icons/192.png" ? icono192 : icono512), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    }
    if (p === "/salud") return json({ ok: true, version: VERSION, base_de_datos: app.db.dialect, modo: modo.servidor ? "servidor" : "local" });

    // MCP remoto y OAuth (solo en modo servidor; en local la IA usa stdio).
    if (modo.servidor) {
      const oauth = await auth.manejarOAuth(req, ipDe(req));
      if (oauth) return oauth;
      if (p === "/mcp") return mcpHttp!(req);
    }

    if (p === "/api/sesion") {
      const blocked = guardRequest(req, modo.hosts);
      if (blocked) return blocked;
      const cfg = await getConfig(app.db);
      if (req.method === "GET") {
        const actor = await getActor(req);
        return json({
          negocio: cfg.nombre_negocio,
          requiere_pin: modo.servidor || cfg.requerir_pin === "1",
          modo: modo.servidor ? "servidor" : "local",
          usuario: actor instanceof Response ? null : { nombre: actor.usuario, rol: actor.rol },
        });
      }
      if (req.method === "POST") {
        const ip = ipDe(req);
        if (auth.limitador.bloqueado(ip)) return json({ ok: false, error: "Demasiados intentos. Espera unos minutos." }, 429);
        const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
        const id = await verificarPin(String(pin ?? ""));
        if (!id) {
          auth.limitador.fallo(ip);
          await Bun.sleep(400);
          return json({ ok: false, error: "PIN incorrecto" }, 401);
        }
        auth.limitador.exito(ip);
        const token = await auth.crearSesion(id);
        return new Response(JSON.stringify({ ok: true, usuario: { nombre: id.usuario, rol: id.rol } }), {
          headers: { "content-type": "application/json", "set-cookie": auth.cookieSesion(token) },
        });
      }
      if (req.method === "DELETE") {
        await auth.cerrarSesion(req);
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "set-cookie": auth.cookieSesion(null) } });
      }
    }

    if (p === "/api/subir" && req.method === "POST") {
      const blocked = guardRequest(req, modo.hosts);
      if (blocked) return blocked;
      const actor = await getActor(req);
      if (actor instanceof Response) return actor;
      const form = await req.formData();
      const file = form.get("archivo");
      if (!(file instanceof File)) return json({ ok: false, error: "Falta el archivo" }, 400);
      const ext = extname(file.name).toLowerCase();
      if (!SUBIDAS_EXT.includes(ext)) return json({ ok: false, error: `Tipo de archivo no permitido (${ext})` }, 400);
      if (file.size > 20 * 1024 * 1024) return json({ ok: false, error: "El archivo pesa más de 20 MB" }, 400);
      // Carpeta única por subida, conservando el nombre original (lo ve la persona en la vista previa).
      const dir = join(app.dataDir, "subidas", crypto.randomUUID());
      mkdirSync(dir, { recursive: true });
      const seguro = basename(file.name).replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 120) || `archivo${ext}`;
      const ruta = join(dir, seguro);
      await Bun.write(ruta, file);
      return json({ ok: true, ruta, nombre: file.name });
    }

    const apiRes = await api(req);
    if (apiRes) return apiRes;

    const m = p.match(/^\/archivos\/([a-z]+)\/([^/]+)$/);
    if (m && ARCHIVOS.includes(m[1]!)) {
      const blocked = guardRequest(req, modo.hosts);
      if (blocked) return blocked;
      if (!firmaValida(p, url.searchParams.get("f"))) {
        const actor = await getActor(req);
        if (actor instanceof Response) return new Response("No autorizado", { status: 401 });
      }
      const name = basename(decodeURIComponent(m[2]!));
      const f = Bun.file(join(app.dataDir, m[1]!, name));
      if (!(await f.exists())) return new Response("No encontrado", { status: 404 });
      const headers: Record<string, string> = { "cache-control": "no-store" };
      if (m[1] === "exportaciones") headers["content-disposition"] = `attachment; filename="${name}"`;
      return new Response(f, { headers });
    }
    return new Response("No encontrado", { status: 404 });
  };

  let server: ReturnType<typeof Bun.serve> | undefined;
  let lastError: unknown;
  const intentos = modo.servidor ? [opts.port] : Array.from({ length: 10 }, (_, i) => opts.port + i);
  for (const port of intentos) {
    try {
      server = Bun.serve({
        hostname: modo.servidor ? "0.0.0.0" : "127.0.0.1",
        port,
        development: !isCompiled && process.env.NODE_ENV !== "production" && !modo.servidor,
        routes: { "/": ui },
        fetch: handler,
      });
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!server) throw lastError;
  const srv = server;

  const url = modo.urlPublica ?? `http://localhost:${srv.port}`;
  // Detrás del proxy de Railway la IP real viene en X-Forwarded-For. Se toma la última entrada
  // (la agrega el proxy); las primeras las puede inventar quien hace la petición.
  ipDe = modo.servidor
    ? (req) => req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || srv.requestIP(req)?.address || "?"
    : (req) => srv.requestIP(req)?.address ?? "local";
  auth = new Auth({ db: app.db, urlPublica: url, nombreApp: (await getConfig(app.db)).nombre_negocio ?? "Kromo Cargo", logoSvg, verificarPin });
  mcpHttp = createMcpHttpHandler(app.registry, mcpOptions(app), auth);
  if (modo.servidor) {
    app.registry.configurarArchivos({ rutasPermitidas: join(app.dataDir, "subidas"), urlArchivo: (rel) => `${url}${firmar(rel)}` });
  }

  const infoFile = join(app.dataDir, "servidor.json");
  writeFileSync(infoFile, JSON.stringify({ url, pid: process.pid }));
  const cleanup = () => {
    if (existsSync(infoFile)) rmSync(infoFile);
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  if (opts.open && !modo.servidor) abrirNavegador(url);
  return { server: srv, url };
}

/** Cabeceras de seguridad para todo lo que sirve el handler (API, MCP, OAuth y archivos). */
function conCabeceras(res: Response): Response {
  const h = res.headers;
  if (!h.has("x-content-type-options")) h.set("x-content-type-options", "nosniff");
  if (!h.has("referrer-policy")) h.set("referrer-policy", "no-referrer");
  if (!h.has("x-frame-options")) h.set("x-frame-options", "DENY");
  return res;
}

export function abrirNavegador(url: string) {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    /* sin navegador: el usuario abre la URL manualmente */
  }
}

export { CSRF_HEADER };
