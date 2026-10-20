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
import { establecerDominio, establecerModo, modo as modoProceso, type Modo } from "./config.ts";
import { ahora, getConfig } from "./lib.ts";
import ui from "./ui/index.html";
import icono192 from "./ui/assets/icon-192.png" with { type: "file" };
import icono512 from "./ui/assets/icon-512.png" with { type: "file" };
import logoSvg from "./ui/assets/logo.svg" with { type: "text" };

const ARCHIVOS = ["fotos", "etiquetas", "exportaciones", "respaldos"];
const DESCARGAS = ["exportaciones", "respaldos"];
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
  background_color: "#020617",
  theme_color: "#020617",
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

const hayUsuarios = async (app: App) => Number((await app.db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM usuarios"))?.n ?? 0) > 0;

/**
 * En modo servidor el inicio de sesión es obligatorio. Sin usuarios, la UI muestra "Crea tu cuenta"
 * (primer registro). KROMO_PIN_INICIAL, si existe, crea un dueño "dueno" con esa contraseña provisional
 * (despliegues automatizados).
 */
export async function prepararServidor(app: App, modo: Modo, env = process.env) {
  if (!modo.servidor) return;
  const inicial = env.KROMO_PIN_INICIAL ?? "";
  if (!(await hayUsuarios(app)) && inicial) {
    if (inicial.length < 6) throw new Error("KROMO_PIN_INICIAL debe tener al menos 6 caracteres.");
    await app.db.run("INSERT INTO usuarios (nombre, usuario, rol, pin_hash, password_hash, creado_en) VALUES (?, 'dueno', 'dueno', '', ?, ?)", [
      env.KROMO_DUENO || "Dueño",
      await Bun.password.hash(inicial),
      ahora(),
    ]);
  }
  await app.db.run("UPDATE configuracion SET valor = '1' WHERE clave = 'requerir_pin'");
}

const USUARIO_RE = /^[a-z0-9._-]{3,40}$/;
// Hash de relleno: verificar contra él cuando el usuario no existe iguala los tiempos de respuesta.
const HASH_RELLENO = Bun.password.hashSync("relleno-para-tiempos-iguales");

/** Usuario y contraseña. Usuarios anteriores a la v2 (sin usuario) entran con su nombre y su PIN. */
export async function verificarCredenciales(app: App, usuario: string, contrasena: string): Promise<(Identidad & { pendiente?: boolean }) | null> {
  const u = usuario.toLowerCase().replace(/\s/g, "");
  if (!u || !contrasena || contrasena.length > 200) return null;
  const row = await app.db.get("SELECT nombre, rol, password_hash FROM usuarios WHERE activo = 1 AND usuario = ?", [u]);
  if (row?.password_hash) return (await Bun.password.verify(contrasena, row.password_hash)) ? { usuario: row.nombre, rol: row.rol } : null;
  const antiguo = await app.db.get(
    "SELECT nombre, rol, pin_hash FROM usuarios WHERE activo = 1 AND password_hash IS NULL AND REPLACE(LOWER(nombre), ' ', '') = ? AND pin_hash <> ''",
    [u],
  );
  if (antiguo && (await Bun.password.verify(contrasena, antiguo.pin_hash))) return { usuario: antiguo.nombre, rol: antiguo.rol, pendiente: true };
  await Bun.password.verify(contrasena, HASH_RELLENO);
  return null;
}

/** PIN de caja: solo entre usuarios activos con PIN. */
async function verificarPinCaja(app: App, pin: string): Promise<Identidad | null> {
  if (!/^\d{4,12}$/.test(pin)) return null;
  for (const u of await app.db.all("SELECT nombre, rol, pin_hash FROM usuarios WHERE activo = 1 AND pin_hash <> ''")) {
    if (await Bun.password.verify(pin, u.pin_hash)) return { usuario: u.nombre, rol: u.rol };
  }
  return null;
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
  // A partir de aquí se usa el modo del proceso: las acciones (p. ej. el dominio propio) lo cambian en vivo.
  establecerModo(opts.modo);
  const modo = modoProceso;
  await prepararServidor(app, modo);
  const dominioGuardado = (await getConfig(app.db)).dominio;
  if (modo.servidor && dominioGuardado) establecerDominio(dominioGuardado);
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


  const getActor = async (req: Request): Promise<Actor | Response> => {
    if (!modo.servidor && (await getConfig(app.db)).requerir_pin !== "1") return { tipo: "humano", cliente: "ui", usuario: "Dueño", rol: "dueno" };
    return (await auth.leerSesion(req)) ?? json({ ok: false, error: "Sesión expirada. Ingresa tu PIN.", sesion: false }, 401);
  };

  const api = createApiHandler(app.registry, { getActor, allowedHosts: modo.hosts });
  let mcpHttp: ((req: Request) => Promise<Response>) | null = null;

  const hsts = modo.servidor && (modo.urlPublica ?? "").startsWith("https://");
  const conCookies = (data: unknown, cookies: string[], status = 200) => {
    const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
    for (const c of cookies) headers.append("set-cookie", c);
    return new Response(JSON.stringify(data), { status, headers });
  };

  /** Abre sesión y marca el navegador como equipo de confianza (para cambiar de cajero con PIN). */
  const entrar = async (id: Identidad & { pendiente?: boolean }, conEquipo: boolean) => {
    const cookies = [auth.cookieSesion(await auth.crearSesion(id))];
    if (conEquipo) cookies.push(auth.cookieEquipo(await auth.crearEquipo(id.usuario)));
    return conCookies({ ok: true, usuario: { nombre: id.usuario, rol: id.rol, pendiente: !!id.pendiente } }, cookies);
  };

  const requiereLogin = async () => modo.servidor || (await getConfig(app.db)).requerir_pin === "1";

  const sesionApi = async (req: Request, p: string): Promise<Response> => {
    const ip = ipDe(req);
    const cuerpo = async () => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const frenar = async () => {
      auth.limitador.fallo(ip);
      await Bun.sleep(400);
    };

    if (p === "/api/sesion" && req.method === "GET") {
      const cfg = await getConfig(app.db);
      const actor = await getActor(req);
      const usuario = actor instanceof Response ? null : { nombre: actor.usuario, rol: actor.rol, pendiente: false };
      if (usuario && (await requiereLogin())) {
        const u = await app.db.get("SELECT password_hash FROM usuarios WHERE nombre = ? AND activo = 1", [usuario.nombre]);
        usuario.pendiente = !!u && !u.password_hash;
      }
      const hayPin = Number((await app.db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM usuarios WHERE activo = 1 AND pin_hash <> ''"))?.n ?? 0) > 0;
      return json({
        negocio: cfg.nombre_negocio,
        requiere_pin: await requiereLogin(),
        modo: modo.servidor ? "servidor" : "local",
        despliegue: modo.despliegue,
        registro: modo.servidor && !(await hayUsuarios(app)),
        equipo: hayPin && (await auth.equipoValido(req)),
        version: VERSION,
        usuario,
      });
    }

    if (p === "/api/sesion" && req.method === "POST") {
      if (auth.limitador.bloqueado(ip)) return json({ ok: false, error: "Demasiados intentos. Espera unos minutos." }, 429);
      const b = await cuerpo();
      const id = await verificarCredenciales(app, String(b.usuario ?? ""), String(b.contrasena ?? ""));
      if (!id) {
        await frenar();
        return json({ ok: false, error: "Usuario o contraseña incorrectos" }, 401);
      }
      auth.limitador.exito(ip);
      return entrar(id, true);
    }

    if (p === "/api/sesion/pin" && req.method === "POST") {
      if (!(await auth.equipoValido(req))) return json({ ok: false, error: "En este equipo entra primero con usuario y contraseña." }, 403);
      if (auth.limitador.bloqueado(ip)) return json({ ok: false, error: "Demasiados intentos. Espera unos minutos." }, 429);
      const id = await verificarPinCaja(app, String((await cuerpo()).pin ?? ""));
      if (!id) {
        await frenar();
        return json({ ok: false, error: "PIN incorrecto" }, 401);
      }
      auth.limitador.exito(ip);
      return entrar(id, false);
    }

    if (p === "/api/sesion" && req.method === "DELETE") {
      // Bloquear conserva el equipo (se vuelve a entrar con PIN); "olvidar" lo desvincula.
      await auth.cerrarSesion(req);
      const cookies = [auth.cookieSesion(null)];
      if (new URL(req.url).searchParams.get("olvidar") === "1") {
        await auth.olvidarEquipo(req);
        cookies.push(auth.cookieEquipo(null));
      }
      return conCookies({ ok: true }, cookies);
    }

    if (p === "/api/registro" && req.method === "POST") {
      if (!modo.servidor) return json({ ok: false, error: "El registro es solo para la app en servidor." }, 400);
      if (auth.limitador.bloqueado(ip)) return json({ ok: false, error: "Demasiados intentos. Espera unos minutos." }, 429);
      const b = await cuerpo();
      const datos = validarCuenta(b);
      if ("error" in datos) return json({ ok: false, error: datos.error }, 400);
      const nombre = String(b.nombre ?? "").trim().slice(0, 60);
      const negocio = String(b.negocio ?? "").trim().slice(0, 120);
      const pin = String(b.pin ?? "");
      if (!nombre) return json({ ok: false, error: "Escribe tu nombre." }, 400);
      if (pin && !/^\d{4,12}$/.test(pin)) return json({ ok: false, error: "El PIN de caja debe tener de 4 a 12 dígitos." }, 400);
      const [password_hash, pin_hash] = [await Bun.password.hash(datos.contrasena), pin ? await Bun.password.hash(pin) : ""];
      // El primero gana: el INSERT solo ocurre si la tabla sigue vacía, dentro de la misma transacción.
      const creado = await app.db.transaction(async (tx) => {
        if (Number((await tx.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM usuarios"))?.n ?? 0) > 0) return false;
        await tx.run("INSERT INTO usuarios (nombre, usuario, rol, pin_hash, password_hash, creado_en) VALUES (?, ?, 'dueno', ?, ?, ?)", [
          nombre,
          datos.usuario,
          pin_hash,
          password_hash,
          ahora(),
        ]);
        if (negocio) await tx.run("UPDATE configuracion SET valor = ? WHERE clave = 'nombre_negocio'", [negocio]);
        return true;
      });
      if (!creado) return json({ ok: false, error: "Esta app ya tiene dueño. Inicia sesión." }, 409);
      return entrar({ usuario: nombre, rol: "dueno" }, true);
    }

    if (p === "/api/cuenta" && req.method === "POST") {
      // Usuario anterior a la v2: define su usuario y contraseña la primera vez que entra.
      const actor = await getActor(req);
      if (actor instanceof Response) return actor;
      const u = await app.db.get("SELECT id, password_hash FROM usuarios WHERE nombre = ? AND activo = 1", [actor.usuario]);
      if (!u || u.password_hash) return json({ ok: false, error: "Tu cuenta ya tiene usuario y contraseña." }, 400);
      const datos = validarCuenta(await cuerpo());
      if ("error" in datos) return json({ ok: false, error: datos.error }, 400);
      if (await app.db.get("SELECT id FROM usuarios WHERE usuario = ? AND id <> ?", [datos.usuario, u.id])) {
        return json({ ok: false, error: "Ese usuario ya existe. Elige otro." }, 400);
      }
      await app.db.run("UPDATE usuarios SET usuario = ?, password_hash = ? WHERE id = ?", [datos.usuario, await Bun.password.hash(datos.contrasena), u.id]);
      return entrar({ usuario: actor.usuario!, rol: actor.rol! }, true);
    }

    return json({ ok: false, error: "No encontrado" }, 404);
  };

  const handler = async (req: Request): Promise<Response> => conCabeceras(await manejar(req), hsts);

  // En producción Bun sirve el HTML de la UI en una ruta interna que no pasa por el handler (sin
  // cabeceras). "/" lo pide una vez por loopback y lo sirve desde aquí con CSP y demás cabeceras.
  // En desarrollo se queda en "/" para que funcione el recargado en caliente.
  const desarrollo = !isCompiled && process.env.NODE_ENV !== "production" && !modo.servidor;
  const rutaUi = desarrollo ? "/" : `/__ui-${crypto.randomUUID()}`;
  let paginaUi: Promise<string> | undefined;
  const servirUi = async () => {
    paginaUi ??= fetch(`http://127.0.0.1:${server!.port}${rutaUi}`).then((r) => {
      if (!r.ok) throw new Error(`UI ${r.status}`);
      return r.text();
    });
    const html = await paginaUi.catch((e) => {
      paginaUi = undefined;
      throw e;
    });
    return new Response(html, { headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-cache", "content-security-policy": CSP_UI } });
  };

  const manejar = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/manifest.webmanifest") return new Response(MANIFEST, { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=86400" } });
    if (p === "/icons/192.png" || p === "/icons/512.png") {
      return new Response(Bun.file(p === "/icons/192.png" ? icono192 : icono512), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    }
    if (p === "/" && rutaUi !== "/" && (req.method === "GET" || req.method === "HEAD")) return servirUi();
    if (p === "/salud") return json({ ok: true, version: VERSION, base_de_datos: app.db.dialect, modo: modo.servidor ? "servidor" : "local" });

    // MCP remoto y OAuth (solo en modo servidor; en local la IA usa stdio).
    if (modo.servidor) {
      const oauth = await auth.manejarOAuth(req, ipDe(req));
      if (oauth) return oauth;
      if (p === "/mcp") return mcpHttp!(req);
    }

    if (p.startsWith("/api/sesion") || p === "/api/registro" || p === "/api/cuenta") {
      const blocked = guardRequest(req, modo.hosts);
      if (blocked) return blocked;
      return sesionApi(req, p);
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
        if (m[1] === "respaldos" && actor.rol !== "dueno") return new Response("Solo un dueño puede descargar respaldos", { status: 403 });
      }
      const name = basename(decodeURIComponent(m[2]!));
      const f = Bun.file(join(app.dataDir, m[1]!, name));
      if (!(await f.exists())) return new Response("No encontrado", { status: 404 });
      const headers: Record<string, string> = { "cache-control": "no-store" };
      if (DESCARGAS.includes(m[1]!)) headers["content-disposition"] = `attachment; filename="${name}"`;
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
        development: desarrollo,
        routes: { [rutaUi]: ui },
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
  const urlActual = () => modo.urlPublica ?? url;
  auth = new Auth({
    db: app.db,
    urlPublica: urlActual,
    nombreApp: (await getConfig(app.db)).nombre_negocio ?? "Kromo Cargo",
    logoSvg,
    verificarCredenciales: (u, c) => verificarCredenciales(app, u, c),
  });
  mcpHttp = createMcpHttpHandler(app.registry, mcpOptions(app), auth);
  if (modo.servidor) {
    app.registry.configurarArchivos({ rutasPermitidas: join(app.dataDir, "subidas"), urlArchivo: (rel) => `${urlActual()}${firmar(rel)}` });
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

/** Valida usuario (3-40: letras, números, punto, guion) y contraseña (8+). */
export function validarCuenta(b: Record<string, unknown>): { usuario: string; contrasena: string } | { error: string } {
  const usuario = String(b.usuario ?? "").trim().toLowerCase();
  const contrasena = String(b.contrasena ?? "");
  if (!USUARIO_RE.test(usuario)) return { error: "El usuario debe tener de 3 a 40 letras, números, punto o guion, sin espacios." };
  if (contrasena.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres." };
  if (contrasena.length > 200) return { error: "La contraseña es demasiado larga." };
  return { usuario, contrasena };
}

/** Política para la UI: solo recursos propios; fuentes e imágenes también como data:/blob:. */
const CSP_UI = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Cabeceras de seguridad para todo lo que sirve el handler (UI, API, MCP, OAuth y archivos). */
function conCabeceras(res: Response, hsts: boolean): Response {
  const h = res.headers;
  if (!h.has("x-content-type-options")) h.set("x-content-type-options", "nosniff");
  if (!h.has("referrer-policy")) h.set("referrer-policy", "no-referrer");
  if (!h.has("x-frame-options")) h.set("x-frame-options", "DENY");
  if (!h.has("permissions-policy")) h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (hsts && !h.has("strict-transport-security")) h.set("strict-transport-security", "max-age=31536000");
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
