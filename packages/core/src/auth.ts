import { z } from "zod";
import { defineAction, type Actor, type Rol } from "./actions.ts";
import { ahora, type Db } from "./db.ts";

/**
 * Autenticación para el modo servidor:
 * - Sesiones de la UI (cookie HttpOnly, guardadas en la base: sobreviven reinicios).
 * - Tokens de acceso para IAs remotas (Claude Code, Codex, Gemini CLI con encabezado Authorization).
 * - OAuth 2.1 con PKCE y registro dinámico (conectores de claude.ai y ChatGPT).
 * Los tokens se guardan solo como hash SHA-256.
 */

export const COOKIE_SESION = "kromo_sesion";
export const COOKIE_EQUIPO = "kromo_equipo";
const SESION_TTL_MS = 12 * 60 * 60 * 1000;
const EQUIPO_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODIGO_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const CONOCIDA_MS = 30 * 24 * 60 * 60 * 1000;
export const SCOPE = "mcp";

export const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const aleatorio = (bytes = 32) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
const b64url = (buf: ArrayBuffer | Uint8Array) => Buffer.from(buf as ArrayBuffer).toString("base64url");

export interface Identidad {
  usuario: string;
  rol: Rol;
  /** Nombre del cliente de IA ("Claude", "ChatGPT", nombre del token…). */
  cliente?: string;
}

/**
 * Frena ataques de fuerza bruta contra la contraseña y el PIN: por IP y global. El límite global no aplica a las IP
 * que ya entraron con éxito, para que un ataque desde muchas IP no deje fuera al personal de la tienda.
 */
export class Limitador {
  private fallos = new Map<string, number[]>();
  private conocidas = new Map<string, number>();
  constructor(
    private porIp = 5,
    private global = 20,
    private ventanaMs = 10 * 60 * 1000,
  ) {}
  private recientes(clave: string) {
    const ahoraMs = Date.now();
    const l = (this.fallos.get(clave) ?? []).filter((t) => ahoraMs - t < this.ventanaMs);
    if (l.length) this.fallos.set(clave, l);
    else this.fallos.delete(clave);
    return l;
  }
  bloqueado(ip: string): boolean {
    if (this.recientes(ip).length >= this.porIp) return true;
    const conocida = (this.conocidas.get(ip) ?? 0) > Date.now() - CONOCIDA_MS;
    return !conocida && this.recientes("*").length >= this.global;
  }
  fallo(ip: string) {
    if (this.fallos.size > 10_000) for (const clave of [...this.fallos.keys()]) this.recientes(clave);
    for (const clave of [ip, "*"]) this.fallos.set(clave, [...this.recientes(clave), Date.now()]);
  }
  exito(ip: string) {
    this.fallos.delete(ip);
    this.conocidas.set(ip, Date.now());
  }
}

export interface AuthOptions {
  db: Db;
  /** URL pública del servidor, sin "/" final (p. ej. https://mi-tienda.up.railway.app). Función si puede cambiar (dominio propio). */
  urlPublica: string | (() => string);
  nombreApp: string;
  /** SVG inline del logo de la app para las páginas de autorización (opcional). */
  logoSvg?: string;
  /** Verifica usuario y contraseña y regresa la identidad, o null. */
  verificarCredenciales: (usuario: string, contrasena: string) => Promise<Identidad | null>;
  limitador?: Limitador;
}

export class Auth {
  readonly limitador: Limitador;
  private get marca(): Marca {
    return { app: this.o.nombreApp, logo: this.o.logoSvg };
  }
  constructor(private o: AuthOptions) {
    this.limitador = o.limitador ?? new Limitador();
  }

  get url(): string {
    return typeof this.o.urlPublica === "function" ? this.o.urlPublica() : this.o.urlPublica;
  }
  get recursoMcp() {
    return `${this.url}/mcp`;
  }
  get metadataRecurso() {
    return `${this.url}/.well-known/oauth-protected-resource`;
  }

  // ── Sesiones de la UI ──────────────────────────────────────────────

  async crearSesion(id: Identidad): Promise<string> {
    const token = aleatorio();
    await this.o.db.run("DELETE FROM sesiones WHERE expira < ?", [Date.now()]);
    await this.o.db.run("INSERT INTO sesiones (token_hash, usuario, rol, expira, creado_en) VALUES (?, ?, ?, ?, ?)", [
      sha256(token),
      id.usuario,
      id.rol,
      Date.now() + SESION_TTL_MS,
      ahora(),
    ]);
    return token;
  }

  async leerSesion(req: Request): Promise<Actor | null> {
    const token = leerCookie(req, COOKIE_SESION);
    if (!token) return null;
    const s = await this.o.db.get("SELECT usuario, rol, expira FROM sesiones WHERE token_hash = ?", [sha256(token)]);
    if (!s || Number(s.expira) < Date.now()) return null;
    return { tipo: "humano", cliente: "ui", usuario: s.usuario, rol: s.rol };
  }

  async cerrarSesion(req: Request) {
    const token = leerCookie(req, COOKIE_SESION);
    if (token) await this.o.db.run("DELETE FROM sesiones WHERE token_hash = ?", [sha256(token)]);
  }

  cookieSesion(token: string | null): string {
    return this.cookie(COOKIE_SESION, token, SESION_TTL_MS);
  }

  private cookie(nombre: string, token: string | null, ttlMs: number): string {
    const seguro = this.url.startsWith("https://") ? "; Secure" : "";
    if (!token) return `${nombre}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${seguro}`;
    return `${nombre}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttlMs / 1000}${seguro}`;
  }

  // ── Equipos de confianza (cambio de cajero con PIN) ───────────────

  /** Marca este navegador como equipo de la tienda: alguien entró aquí con usuario y contraseña. */
  async crearEquipo(usuario: string): Promise<string> {
    const token = aleatorio();
    await this.o.db.run("DELETE FROM equipos WHERE expira < ?", [Date.now()]);
    await this.o.db.run("INSERT INTO equipos (token_hash, usuario, expira, creado_en) VALUES (?, ?, ?, ?)", [
      sha256(token),
      usuario,
      Date.now() + EQUIPO_TTL_MS,
      ahora(),
    ]);
    return token;
  }

  async equipoValido(req: Request): Promise<boolean> {
    const token = leerCookie(req, COOKIE_EQUIPO);
    if (!token) return false;
    const e = await this.o.db.get("SELECT expira FROM equipos WHERE token_hash = ?", [sha256(token)]);
    return !!e && Number(e.expira) > Date.now();
  }

  async olvidarEquipo(req: Request) {
    const token = leerCookie(req, COOKIE_EQUIPO);
    if (token) await this.o.db.run("DELETE FROM equipos WHERE token_hash = ?", [sha256(token)]);
  }

  cookieEquipo(token: string | null): string {
    return this.cookie(COOKIE_EQUIPO, token, EQUIPO_TTL_MS);
  }

  // ── Tokens Bearer (IA remota) ─────────────────────────────────────

  /** Valida un token Bearer (de acceso personal o de OAuth) y regresa a quién pertenece. */
  async validarBearer(req: Request): Promise<(Identidad & { clientId: string; expira?: number; token: string }) | null> {
    const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token) return null;
    const a = await this.o.db.get(
      "SELECT id, tipo, nombre, client_id, usuario, rol, expira, ultimo_uso FROM accesos WHERE token_hash = ? AND revocado = 0",
      [sha256(token)],
    );
    if (!a || (a.expira && Number(a.expira) < Date.now())) return null;
    const now = ahora();
    if (a.ultimo_uso?.slice(0, 16) !== now.slice(0, 16)) await this.o.db.run("UPDATE accesos SET ultimo_uso = ? WHERE id = ?", [now, a.id]);
    return {
      usuario: a.usuario,
      rol: a.rol,
      cliente: a.nombre,
      clientId: a.client_id ?? `token-${a.id}`,
      expira: a.expira ? Math.floor(Number(a.expira) / 1000) : undefined,
      token,
    };
  }

  /** Respuesta 401 que indica a los clientes MCP dónde está el servidor de autorización. */
  noAutorizado(mensaje = "Falta un token válido"): Response {
    return new Response(JSON.stringify({ error: "invalid_token", error_description: mensaje }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer resource_metadata="${this.metadataRecurso}"`,
        ...CORS,
      },
    });
  }

  // ── OAuth 2.1 ─────────────────────────────────────────────────────

  /** Atiende las rutas de OAuth. Regresa null si la ruta no es suya. */
  async manejarOAuth(req: Request, ip: string): Promise<Response | null> {
    const url = new URL(req.url);
    const p = url.pathname;
    if (req.method === "OPTIONS" && (p.startsWith("/.well-known/") || p.startsWith("/oauth/") || p === "/mcp")) {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (req.method === "GET" && p.startsWith("/.well-known/oauth-protected-resource")) {
      return jsonCors({
        resource: this.recursoMcp,
        authorization_servers: [this.url],
        scopes_supported: [SCOPE],
        bearer_methods_supported: ["header"],
        resource_name: this.o.nombreApp,
      });
    }
    if (req.method === "GET" && (p === "/.well-known/oauth-authorization-server" || p === "/.well-known/openid-configuration")) {
      const u = this.url;
      return jsonCors({
        issuer: u,
        authorization_endpoint: `${u}/oauth/autorizar`,
        token_endpoint: `${u}/oauth/token`,
        registration_endpoint: `${u}/oauth/registro`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: [SCOPE],
      });
    }
    if (req.method === "POST" && p === "/oauth/registro") return this.registrar(req);
    if (p === "/oauth/autorizar") return req.method === "POST" ? this.autorizarPost(req, ip) : this.autorizarGet(url);
    if (req.method === "POST" && p === "/oauth/token") return this.token(req);
    return null;
  }

  private async registrar(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => null)) as { client_name?: string; redirect_uris?: string[] } | null;
    const uris = body?.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || !uris.every(redirectValida)) {
      return jsonCors({ error: "invalid_redirect_uri", error_description: "redirect_uris debe usar https (o http://localhost)" }, 400);
    }
    const client_id = `cli_${aleatorio(16)}`;
    const nombre = String(body?.client_name ?? "Cliente MCP").slice(0, 80);
    await this.o.db.run("INSERT INTO oauth_clientes (client_id, nombre, redirect_uris, creado_en) VALUES (?, ?, ?, ?)", [
      client_id,
      nombre,
      JSON.stringify(uris),
      ahora(),
    ]);
    return jsonCors(
      {
        client_id,
        client_name: nombre,
        redirect_uris: uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      201,
    );
  }

  private async validarSolicitud(params: URLSearchParams) {
    const client = await this.o.db.get("SELECT client_id, nombre, redirect_uris FROM oauth_clientes WHERE client_id = ?", [params.get("client_id") ?? ""]);
    if (!client) return { error: "La aplicación que pide acceso no está registrada." };
    const redirect = params.get("redirect_uri") ?? "";
    if (!(JSON.parse(client.redirect_uris) as string[]).includes(redirect)) return { error: "La dirección de regreso no coincide con la registrada." };
    if (params.get("response_type") !== "code") return { error: "Solo se admite response_type=code." };
    if (!params.get("code_challenge") || params.get("code_challenge_method") !== "S256") return { error: "Se requiere PKCE (S256)." };
    return { client, redirect };
  }

  private async autorizarGet(url: URL): Promise<Response> {
    const v = await this.validarSolicitud(url.searchParams);
    if ("error" in v) return html(paginaError(this.marca, v.error!), 400);
    return html(paginaAutorizar(this.marca, v.client.nombre, v.redirect, url.searchParams));
  }

  private async autorizarPost(req: Request, ip: string): Promise<Response> {
    const form = new URLSearchParams(await req.text());
    const v = await this.validarSolicitud(form);
    if ("error" in v) return html(paginaError(this.marca, v.error!), 400);
    if (form.get("accion") === "cancelar") return redirigir(v.redirect, { error: "access_denied", state: form.get("state") });
    if (this.limitador.bloqueado(ip)) {
      return html(paginaAutorizar(this.marca, v.client.nombre, v.redirect, form, "Demasiados intentos. Espera unos minutos."), 429);
    }
    const id = await this.o.verificarCredenciales(form.get("usuario") ?? "", form.get("contrasena") ?? "");
    if (!id || id.rol !== "dueno") {
      this.limitador.fallo(ip);
      await Bun.sleep(300);
      return html(
        paginaAutorizar(this.marca, v.client.nombre, v.redirect, form, id ? "Solo un dueño puede conectar una IA." : "Usuario o contraseña incorrectos."),
        401,
      );
    }
    this.limitador.exito(ip);
    const codigo = aleatorio();
    await this.o.db.run(
      "INSERT INTO oauth_codigos (codigo_hash, client_id, redirect_uri, challenge, usuario, rol, expira) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [sha256(codigo), v.client.client_id, v.redirect, form.get("code_challenge"), id.usuario, id.rol, Date.now() + CODIGO_TTL_MS],
    );
    return redirigir(v.redirect, { code: codigo, state: form.get("state") });
  }

  private async token(req: Request): Promise<Response> {
    const tipo = req.headers.get("content-type") ?? "";
    const params = tipo.includes("application/json")
      ? new URLSearchParams(Object.entries((await req.json().catch(() => ({}))) as Record<string, string>))
      : new URLSearchParams(await req.text());
    const error = (e: string, d: string) => jsonCors({ error: e, error_description: d }, 400);
    const grant = params.get("grant_type");

    if (grant === "authorization_code") {
      return this.o.db.transaction(async (tx) => {
        const c = await tx.get("SELECT * FROM oauth_codigos WHERE codigo_hash = ?", [sha256(params.get("code") ?? "")]);
        if (!c || Number(c.usado) || Number(c.expira) < Date.now()) return error("invalid_grant", "Código inválido o vencido");
        if (c.client_id !== params.get("client_id") || c.redirect_uri !== params.get("redirect_uri")) return error("invalid_grant", "El código no es de este cliente");
        const verifier = params.get("code_verifier") ?? "";
        const calc = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
        if (calc !== c.challenge) return error("invalid_grant", "code_verifier incorrecto");
        await tx.run("UPDATE oauth_codigos SET usado = 1 WHERE codigo_hash = ?", [c.codigo_hash]);
        const cliente = await tx.get("SELECT nombre FROM oauth_clientes WHERE client_id = ?", [c.client_id]);
        return jsonCors(await this.emitir(tx, { client_id: c.client_id, nombre: cliente?.nombre ?? "Cliente MCP", usuario: c.usuario, rol: c.rol }));
      });
    }

    if (grant === "refresh_token") {
      return this.o.db.transaction(async (tx) => {
        const a = await tx.get("SELECT * FROM accesos WHERE refresh_hash = ? AND revocado = 0", [sha256(params.get("refresh_token") ?? "")]);
        if (!a || Number(a.refresh_expira) < Date.now()) return error("invalid_grant", "Refresh token inválido o vencido");
        if (params.get("client_id") && params.get("client_id") !== a.client_id) return error("invalid_grant", "El token no es de este cliente");
        // Rotación: el refresh token anterior deja de servir.
        await tx.run("UPDATE accesos SET revocado = 1 WHERE id = ?", [a.id]);
        return jsonCors(await this.emitir(tx, { client_id: a.client_id, nombre: a.nombre, usuario: a.usuario, rol: a.rol }));
      });
    }
    return error("unsupported_grant_type", "Usa authorization_code o refresh_token");
  }

  private async emitir(db: Db, a: { client_id: string; nombre: string; usuario: string; rol: string }) {
    const access = `kra_${aleatorio()}`;
    const refresh = `krr_${aleatorio()}`;
    await db.run(
      `INSERT INTO accesos (tipo, nombre, client_id, usuario, rol, token_hash, refresh_hash, expira, refresh_expira, creado_en)
       VALUES ('oauth', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.nombre, a.client_id, a.usuario, a.rol, sha256(access), sha256(refresh), Date.now() + ACCESS_TTL_S * 1000, Date.now() + REFRESH_TTL_MS, ahora()],
    );
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE };
  }
}

// ── Acciones para administrar accesos desde la UI (solo dueños, solo HTTP) ──

export const accionesDeAccesos = [
  defineAction({
    name: "listar_accesos",
    title: "Listar accesos de IA",
    description: "Tokens y conexiones OAuth que pueden usar el MCP remoto.",
    kind: "lectura",
    roles: ["dueno"],
    expose: { mcp: false },
    input: z.object({}),
    run: async (_i, { db }) => {
      // Una conexión OAuth rota su token al refrescar; mostramos solo la vigente por cliente.
      const rows = await db.all(
        `SELECT id, tipo, nombre, client_id, usuario, ultimo_uso, creado_en, refresh_expira FROM accesos
         WHERE revocado = 0 AND (tipo = 'token' OR refresh_expira > ?) ORDER BY id DESC`,
        [Date.now()],
      );
      const vistos = new Set<string>();
      return rows
        .filter((r) => (r.tipo === "oauth" ? !vistos.has(r.client_id) && vistos.add(r.client_id) : true))
        .map(({ refresh_expira: _r, ...r }) => r);
    },
  }),
  defineAction({
    name: "crear_token_acceso",
    title: "Crear token de acceso",
    description: "Crea un token para conectar una IA por MCP remoto (Claude Code, Codex, Gemini CLI). Se muestra una sola vez.",
    kind: "escritura",
    roles: ["dueno"],
    expose: { mcp: false },
    input: z.object({ nombre: z.string().trim().min(1).max(60).describe("Para qué es, p. ej. 'Claude Code de Lupe'") }),
    run: async ({ nombre }, { db, actor, setResumen }) => {
      const token = `krt_${aleatorio()}`;
      await db.run("INSERT INTO accesos (tipo, nombre, usuario, rol, token_hash, creado_en) VALUES ('token', ?, ?, ?, ?, ?)", [
        nombre,
        actor.usuario ?? "Dueño",
        "dueno",
        sha256(token),
        ahora(),
      ]);
      setResumen(`Creó el token de acceso "${nombre}"`);
      return { token, aviso: "Cópialo ahora: no se vuelve a mostrar." };
    },
  }),
  defineAction({
    name: "revocar_acceso",
    title: "Revocar acceso",
    description: "Revoca un token o una conexión OAuth: la IA deja de tener acceso de inmediato.",
    kind: "escritura",
    roles: ["dueno"],
    expose: { mcp: false },
    input: z.object({ id: z.number().int() }),
    run: async ({ id }, { db, setResumen }) => {
      const a = await db.get("SELECT tipo, nombre, client_id FROM accesos WHERE id = ?", [id]);
      if (!a) return { revocados: 0 };
      // En OAuth se revocan todos los tokens del mismo cliente.
      if (a.tipo === "oauth") await db.run("UPDATE accesos SET revocado = 1 WHERE client_id = ?", [a.client_id]);
      else await db.run("UPDATE accesos SET revocado = 1 WHERE id = ?", [id]);
      setResumen(`Revocó el acceso "${a.nombre}"`);
      return { revocado: a.nombre };
    },
  }),
];

// ── Utilidades HTTP ───────────────────────────────────────────────────

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS, DELETE",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
};

const jsonCors = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });

export function leerCookie(req: Request, nombre: string): string | null {
  const c = req.headers.get("cookie") ?? "";
  for (const parte of c.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nombre) return v.join("=") || null;
  }
  return null;
}

/** Destinos de los clientes de IA conocidos: Claude, ChatGPT y agentes locales (Claude Code, Gemini CLI…). */
export function destinoConocido(host: string): boolean {
  if (["localhost", "127.0.0.1", "[::1]"].includes(host)) return true;
  return ["claude.ai", "claude.com", "anthropic.com", "chatgpt.com", "openai.com"].some((d) => host === d || host.endsWith(`.${d}`));
}

function redirectValida(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.hash) return false;
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
}

function redirigir(base: string, params: Record<string, string | null>): Response {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { location: u.toString(), "cache-control": "no-store" } });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'",
    },
  });
}

// Mismos tokens que la UI de la app (tema Aurora33) (tema Día / Noche, contraste WCAG AA) y tamaños en rem con base de 16 px.
const ESTILO = `
  :root{color-scheme:light dark;--bg:#fbfcf8;--s:#fff;--b:#e2e8f0;--bi:#7a8799;--t:#0f172a;--t2:#566579;--a:#aff33e;--oa:#000;--f:#4d7c0f;--bad:#c81e1e}
  @media (prefers-color-scheme:dark){:root{--bg:#020617;--s:#0f172a;--b:#1e293b;--bi:#64748b;--t:#f8fafc;--t2:#94a3b8;--a:#aff33e;--oa:#000;--f:#aff33e;--bad:#f87171}}
  *{box-sizing:border-box}html{font-size:100%}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--t);font:1rem/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;padding:1rem}
  .c{background:var(--s);border:1px solid var(--b);border-radius:1.25rem;box-shadow:0 8px 20px hsl(0 0% 0%/.05);padding:1.75rem;width:min(26rem,100%);display:grid;gap:1rem}
  .logo{width:3rem;height:3rem}.logo svg{display:block;width:100%;height:100%}h1{font-size:1.25rem;margin:0;line-height:1.3}p{margin:0;color:var(--t2)}b{color:var(--t)}
  label{font-size:.875rem;font-weight:600}
  input{min-height:2.75rem;font:inherit;padding:0 .75rem;border:1px solid var(--bi);border-radius:.75rem;background:var(--s);color:var(--t);width:100%}
  .f{display:grid;gap:.375rem}
  :focus-visible{outline:3px solid var(--f);outline-offset:2px}
  .r{display:flex;gap:.625rem;flex-wrap:wrap}button{flex:1 1 8rem;min-height:2.75rem;border-radius:.75rem;border:1px solid var(--bi);background:var(--s);color:var(--t);font-family:inherit;font-size:1rem;font-weight:600;cursor:pointer}
  button.p{background:var(--a);border-color:var(--a);color:var(--oa)}.e{color:var(--bad);font-weight:600}ul{margin:0;padding-left:1.25rem;color:var(--t2)}`;

interface Marca {
  app: string;
  logo?: string;
}
const logoHtml = (m: Marca) => (m.logo ? `<div class="logo" aria-hidden="true">${m.logo}</div>` : "");

function paginaAutorizar(m: Marca, cliente: string, redirect: string, params: URLSearchParams, error?: string): string {
  const app = m.app;
  // El nombre lo elige quien registra el cliente; el destino es lo que realmente recibe el acceso.
  const destino = new URL(redirect).hostname;
  const conocido = destinoConocido(destino);
  const ocultos = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"]
    .filter((k) => params.get(k))
    .map((k) => `<input type="hidden" name="${k}" value="${esc(params.get(k)!)}">`)
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar ${esc(cliente)}</title><style>${ESTILO}</style></head>
<body><main class="c"><form method="post" action="/oauth/autorizar" style="display:grid;gap:1rem">${ocultos}
${logoHtml(m)}
<h1>Conectar ${esc(cliente)}</h1>
<p><b>${esc(cliente)}</b> quiere operar <b>${esc(app)}</b> en tu nombre. El acceso se entregará a <b>${esc(destino)}</b>.</p>
${conocido ? "" : `<p class="e">${esc(destino)} no es Claude ni ChatGPT. Permite solo si tú iniciaste esta conexión desde esa aplicación.</p>`}
<ul><li>Consultar productos, ventas y reportes</li><li>Registrar ventas, entradas y ajustes</li><li>Cambiar precios (siempre con vista previa)</li></ul>
<p>Todo queda en el historial y puedes revocar el acceso cuando quieras.</p>
${error ? `<p class="e" role="alert" id="acceso-error">${esc(error)}</p>` : ""}
<p>Entra con tu usuario de dueño para permitirlo.</p>
<div class="f"><label for="usuario">Usuario</label>
<input id="usuario" name="usuario" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus required maxlength="40" value="${esc(params.get("usuario") ?? "")}"${error ? ' aria-describedby="acceso-error"' : ""}></div>
<div class="f"><label for="contrasena">Contraseña</label>
<input id="contrasena" name="contrasena" type="password" autocomplete="current-password" required maxlength="200"${error ? ' aria-invalid="true" aria-describedby="acceso-error"' : ""}></div>
<div class="r"><button name="accion" value="cancelar" formnovalidate>Cancelar</button><button class="p" name="accion" value="permitir">Permitir</button></div>
</form></main></body></html>`;
}

function paginaError(m: Marca, mensaje: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.app)}</title><style>${ESTILO}</style></head>
<body><main class="c">${logoHtml(m)}<h1>No se puede conectar</h1><p class="e">${esc(mensaje)}</p><p>Vuelve a intentarlo desde tu aplicación de IA.</p></main></body></html>`;
}
