import { SQL } from "bun";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type App } from "../src/app.ts";

/** Si existe, la suite corre contra Postgres (una base nueva por prueba). Si no, SQLite en memoria. */
export const PG_URL = process.env.TEST_DATABASE_URL;
export const MOTOR = PG_URL ? "postgres" : "sqlite";

/** Crea una base vacía y aislada. Regresa su URL (o ":memory:") y cómo borrarla. */
export async function freshDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  if (!PG_URL) return { url: ":memory:", drop: async () => {} };
  const name = `kromo_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new SQL(PG_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.close();
  const u = new URL(PG_URL);
  u.pathname = `/${name}`;
  return {
    url: u.toString(),
    drop: async () => {
      const a = new SQL(PG_URL, { max: 1 });
      await a.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.close();
    },
  };
}

export async function testApp(): Promise<{ app: App; dir: string; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), "inv-test-"));
  const { url, drop } = await freshDatabase();
  const app = await createApp(dir, url);
  return {
    app,
    dir,
    cleanup: async () => {
      await app.db.close();
      await drop();
    },
  };
}
