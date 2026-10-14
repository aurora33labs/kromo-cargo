import { Database } from "bun:sqlite";
import { SQL } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type Dialect = "sqlite" | "postgres";

/**
 * Acceso a datos común para SQLite (local, o en un Volume de Railway) y Postgres.
 * - Placeholders posicionales con `?` en ambos motores.
 * - Todo es async para que el mismo código de las acciones sirva en los dos.
 * - Las fechas se guardan como texto local "AAAA-MM-DD HH:MM:SS" generado en JS (ver `ahora()`).
 */
export interface Db {
  readonly dialect: Dialect;
  all<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<void>;
  /** INSERT que regresa el id generado. */
  insert(sql: string, params?: unknown[]): Promise<number>;
  /** Varias sentencias sin parámetros (migraciones). */
  exec(sql: string): Promise<void>;
  /** Transacción exclusiva: en un mismo momento solo una escritura, aun entre procesos. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Fecha y hora local como texto ordenable. En servidores, la zona se fija con la variable TZ. */
export function ahora(offsetDias = 0): string {
  const d = new Date();
  if (offsetDias) d.setDate(d.getDate() + offsetDias);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Fecha local AAAA-MM-DD desplazada n días. */
export const hoy = (offsetDias = 0) => ahora(offsetDias).slice(0, 10);

// ── SQLite ────────────────────────────────────────────────────────────

class SqliteDb implements Db {
  readonly dialect = "sqlite" as const;
  constructor(
    readonly raw: Database,
    private shared: { lock: Promise<unknown> } = { lock: Promise.resolve() },
    private isTx = false,
  ) {}

  async all<T>(sql: string, params: unknown[] = []) {
    return this.raw.query(sql).all(...(params as any[])) as T[];
  }
  async get<T>(sql: string, params: unknown[] = []) {
    return (this.raw.query(sql).get(...(params as any[])) as T) ?? null;
  }
  async run(sql: string, params: unknown[] = []) {
    this.raw.query(sql).run(...(params as any[]));
  }
  async insert(sql: string, params: unknown[] = []) {
    return Number(this.raw.query(sql).run(...(params as any[])).lastInsertRowid);
  }
  async exec(sql: string) {
    this.raw.exec(sql);
  }
  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.isTx) return fn(this);
    // Una sola conexión por proceso: serializamos en memoria, y BEGIN IMMEDIATE bloquea entre procesos.
    const run = async () => {
      this.raw.exec("BEGIN IMMEDIATE");
      try {
        const r = await fn(new SqliteDb(this.raw, this.shared, true));
        this.raw.exec("COMMIT");
        return r;
      } catch (e) {
        this.raw.exec("ROLLBACK");
        throw e;
      }
    };
    const p = this.shared.lock.then(run, run);
    this.shared.lock = p.catch(() => {});
    return p;
  }
  async close() {
    this.raw.close();
  }
}

// ── Postgres ──────────────────────────────────────────────────────────

/** Convierte `?` en `$1, $2…` (nuestro SQL no usa `?` dentro de literales). */
const toPg = (sql: string) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

class PostgresDb implements Db {
  readonly dialect = "postgres" as const;
  constructor(private sql: SQL, private isTx = false) {}

  async all<T>(sql: string, params: unknown[] = []) {
    return [...(await this.sql.unsafe(toPg(sql), params as any[]))] as T[];
  }
  async get<T>(sql: string, params: unknown[] = []) {
    const rows = await this.all<T>(sql, params);
    return rows[0] ?? null;
  }
  async run(sql: string, params: unknown[] = []) {
    await this.sql.unsafe(toPg(sql), params as any[]);
  }
  async insert(sql: string, params: unknown[] = []) {
    const rows = await this.sql.unsafe(toPg(sql) + " RETURNING id", params as any[]);
    return Number(rows[0].id);
  }
  async exec(sql: string) {
    await this.sql.unsafe(sql);
  }
  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.isTx) return fn(this);
    return (await this.sql.begin(async (tx) => {
      // Igual que BEGIN IMMEDIATE en SQLite: serializa escrituras entre procesos (UI, MCP, réplicas).
      await tx.unsafe("SELECT pg_advisory_xact_lock(7343)");
      return fn(new PostgresDb(tx as unknown as SQL, true));
    })) as T;
  }
  async close() {
    await this.sql.close();
  }
}

// ── Migraciones ───────────────────────────────────────────────────────

export interface Migration {
  version: number;
  /**
   * SQL portable. Tokens: {{pk}} = llave primaria autoincremental,
   * {{ahora}} = default de fecha local (las acciones siempre mandan la fecha explícita).
   */
  sql: string;
}

export interface MigrationSet {
  modulo: string;
  migraciones: Migration[];
}

function dialectSql(sql: string, dialect: Dialect): string {
  return sql
    .replaceAll("{{pk}}", dialect === "sqlite" ? "INTEGER PRIMARY KEY" : "INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY")
    .replaceAll("{{ahora}}", dialect === "sqlite" ? "(datetime('now','localtime'))" : "(to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))");
}

const CORE_MIGRATIONS: MigrationSet = {
  modulo: "core",
  migraciones: [
    {
      version: 1,
      sql: `
        CREATE TABLE historial (
          id {{pk}},
          accion TEXT NOT NULL,
          actor_tipo TEXT NOT NULL,
          actor_cliente TEXT,
          actor_usuario TEXT,
          entrada TEXT NOT NULL,
          resultado TEXT,
          resumen TEXT,
          undo TEXT,
          deshecho_en TEXT,
          deshecho_por TEXT,
          creado_en TEXT NOT NULL DEFAULT {{ahora}}
        );
        CREATE INDEX historial_creado ON historial(creado_en);
        CREATE TABLE confirmaciones (
          token TEXT PRIMARY KEY,
          accion TEXT NOT NULL,
          hash TEXT NOT NULL,
          creado_en BIGINT NOT NULL,
          usado INTEGER NOT NULL DEFAULT 0
        );
      `,
    },
    {
      // Sesiones de la UI, tokens de acceso para IAs remotas y OAuth 2.1 (modo servidor).
      version: 2,
      sql: `
        CREATE TABLE sesiones (
          token_hash TEXT PRIMARY KEY,
          usuario TEXT NOT NULL,
          rol TEXT NOT NULL,
          expira BIGINT NOT NULL,
          creado_en TEXT NOT NULL DEFAULT {{ahora}}
        );
        CREATE TABLE oauth_clientes (
          client_id TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          redirect_uris TEXT NOT NULL,
          creado_en TEXT NOT NULL DEFAULT {{ahora}}
        );
        CREATE TABLE oauth_codigos (
          codigo_hash TEXT PRIMARY KEY,
          client_id TEXT NOT NULL,
          redirect_uri TEXT NOT NULL,
          challenge TEXT NOT NULL,
          usuario TEXT NOT NULL,
          rol TEXT NOT NULL,
          expira BIGINT NOT NULL,
          usado INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE accesos (
          id {{pk}},
          tipo TEXT NOT NULL CHECK (tipo IN ('token','oauth')),
          nombre TEXT NOT NULL,
          client_id TEXT,
          usuario TEXT NOT NULL,
          rol TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          refresh_hash TEXT UNIQUE,
          expira BIGINT,
          refresh_expira BIGINT,
          ultimo_uso TEXT,
          revocado INTEGER NOT NULL DEFAULT 0,
          creado_en TEXT NOT NULL DEFAULT {{ahora}}
        );
      `,
    },
  ],
};

export interface OpenOptions {
  /** Carpeta donde guardar un respaldo (solo SQLite) antes de migrar una base existente. */
  backupDir?: string;
}

/**
 * Abre la base y aplica migraciones pendientes.
 * `url`: "postgres://…" para Postgres; ruta de archivo o ":memory:" para SQLite.
 */
export async function openDatabase(url: string, sets: MigrationSet[], opts: OpenOptions = {}): Promise<Db> {
  let db: Db;
  let existed = false;
  if (/^postgres(ql)?:\/\//.test(url)) {
    db = new PostgresDb(new SQL(url, { max: 5 }));
  } else {
    const isMemory = url === ":memory:";
    if (!isMemory) mkdirSync(dirname(url), { recursive: true });
    existed = !isMemory && existsSync(url);
    const raw = new Database(url, { create: true, strict: true });
    raw.exec("PRAGMA journal_mode = WAL;");
    raw.exec("PRAGMA busy_timeout = 5000;");
    raw.exec("PRAGMA foreign_keys = ON;");
    db = new SqliteDb(raw);
  }

  await db.exec("CREATE TABLE IF NOT EXISTS migraciones (modulo TEXT PRIMARY KEY, version INTEGER NOT NULL)");
  await db.transaction(async (tx) => {
    const pending = [];
    for (const set of [CORE_MIGRATIONS, ...sets]) {
      const row = await tx.get<{ version: number }>("SELECT version FROM migraciones WHERE modulo = ?", [set.modulo]);
      const current = Number(row?.version ?? 0);
      pending.push(...set.migraciones.filter((m) => m.version > current).sort((a, b) => a.version - b.version).map((m) => ({ modulo: set.modulo, ...m })));
    }
    if (!pending.length) return;
    if (existed && opts.backupDir && db instanceof SqliteDb) backupSqlite(db, opts.backupDir, "antes-de-migrar");
    for (const m of pending) {
      await tx.exec(dialectSql(m.sql, db.dialect));
      await tx.run(
        "INSERT INTO migraciones (modulo, version) VALUES (?, ?) ON CONFLICT (modulo) DO UPDATE SET version = excluded.version",
        [m.modulo, m.version],
      );
    }
  });
  return db;
}

function backupSqlite(db: SqliteDb, dir: string, etiqueta: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `respaldo-${new Date().toISOString().replace(/[:.]/g, "-")}-${etiqueta}.db`);
  db.raw.query("VACUUM INTO ?").run(file);
  return file;
}

/** Respaldo consistente (funciona con la app abierta). Regresa la ruta del archivo. */
export function backupDatabase(db: Db, dir: string, etiqueta = "manual"): string {
  if (db instanceof SqliteDb) return backupSqlite(db, dir, etiqueta);
  throw new Error("Con Postgres usa pg_dump o los respaldos de tu proveedor (Railway → Backups).");
}

/** Revisión rápida de integridad / conectividad. */
export async function checkDatabase(db: Db): Promise<string> {
  if (db instanceof SqliteDb) return (db.raw.query("PRAGMA quick_check").get() as any)?.quick_check ?? "desconocido";
  await db.get("SELECT 1");
  return "ok";
}

/** Traduce errores de restricción única de ambos motores al nombre del campo. */
export function uniqueViolationField(e: unknown): string | null {
  const err = e as any;
  const msg = String(err?.message ?? "");
  const lite = msg.match(/UNIQUE constraint failed: \w+\.(\w+)/);
  if (lite) return lite[1]!;
  if (err?.errno === "23505" || err?.code === "23505" || /duplicate key value/.test(msg)) {
    const c = String(err?.constraint ?? msg.match(/"([^"]+)"/)?.[1] ?? "");
    return c.replace(/^[a-z]+_/, "").replace(/_key$/, "") || "valor";
  }
  return null;
}
