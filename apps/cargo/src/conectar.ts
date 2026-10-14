import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { APP } from "./app.ts";
import { isCompiled } from "./server.ts";
import skill from "./skill/SKILL.md" with { type: "text" };

export type ClienteId = "claude-code" | "codex" | "gemini" | "claude-desktop";

export interface Cliente {
  id: ClienteId;
  nombre: string;
  detectado: boolean;
  conectado: boolean;
  detalle?: string;
}

export interface Resultado {
  cliente: string;
  ok: boolean;
  mensaje: string;
}

/** Comando con el que los clientes de IA lanzan el servidor MCP. */
export function comandoMcp(): { command: string; args: string[] } {
  if (isCompiled) return { command: process.execPath, args: ["mcp"] };
  return { command: process.execPath, args: [resolve(import.meta.dir, "cli.ts"), "mcp"] };
}

const home = () => process.env.HOME ?? homedir();

function claudeDesktopConfig(): string {
  if (process.platform === "darwin") return join(home(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return join(process.env.XDG_CONFIG_HOME ?? join(home(), ".config"), "Claude", "claude_desktop_config.json");
}

const geminiConfig = () => join(home(), ".gemini", "settings.json");

function enPath(bin: string): boolean {
  return Bun.which(bin) !== null;
}

function run(cmd: string[]): { ok: boolean; out: string } {
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", env: process.env });
  return { ok: p.exitCode === 0, out: (p.stdout.toString() + p.stderr.toString()).trim() };
}

function leerJson(file: string): Record<string, any> {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, "utf8").trim();
  return text ? JSON.parse(text) : {};
}

function escribirJsonConRespaldo(file: string, data: unknown) {
  if (existsSync(file)) copyFileSync(file, `${file}.respaldo-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function detectarClientes(): Cliente[] {
  const clientes: Cliente[] = [];

  const claude = enPath("claude");
  let claudeConectado = false;
  if (claude) claudeConectado = run(["claude", "mcp", "get", APP]).ok;
  clientes.push({ id: "claude-code", nombre: "Claude Code", detectado: claude, conectado: claudeConectado });

  const codex = enPath("codex");
  const codexToml = join(home(), ".codex", "config.toml");
  const codexConectado = existsSync(codexToml) && readFileSync(codexToml, "utf8").includes(`[mcp_servers.${APP}]`);
  clientes.push({ id: "codex", nombre: "Codex CLI", detectado: codex, conectado: codexConectado });

  const gem = geminiConfig();
  const geminiDetectado = enPath("gemini") || existsSync(dirname(gem));
  let geminiConectado = false;
  try {
    geminiConectado = !!leerJson(gem).mcpServers?.[APP];
  } catch {}
  clientes.push({ id: "gemini", nombre: "Gemini CLI", detectado: geminiDetectado, conectado: geminiConectado });

  const cd = claudeDesktopConfig();
  const cdDetectado = existsSync(dirname(cd));
  let cdConectado = false;
  try {
    cdConectado = !!leerJson(cd).mcpServers?.[APP];
  } catch {}
  clientes.push({ id: "claude-desktop", nombre: "Claude Desktop", detectado: cdDetectado, conectado: cdConectado, detalle: cd });

  return clientes;
}

export function conectar(opts: { solo?: ClienteId[]; dryRun?: boolean } = {}): Resultado[] {
  const { command, args } = comandoMcp();
  const resultados: Resultado[] = [];
  for (const c of detectarClientes()) {
    if (opts.solo && !opts.solo.includes(c.id)) continue;
    if (!c.detectado) {
      if (opts.solo) resultados.push({ cliente: c.nombre, ok: false, mensaje: "No está instalado en esta computadora" });
      continue;
    }
    if (opts.dryRun) {
      resultados.push({ cliente: c.nombre, ok: true, mensaje: `Se registraría: ${command} ${args.join(" ")}` });
      continue;
    }
    try {
      switch (c.id) {
        case "claude-code": {
          if (c.conectado) run(["claude", "mcp", "remove", APP, "--scope", "user"]);
          const r = run(["claude", "mcp", "add", "--scope", "user", APP, "--", command, ...args]);
          resultados.push({ cliente: c.nombre, ok: r.ok, mensaje: r.ok ? "Conectado (alcance: usuario)" : r.out });
          break;
        }
        case "codex": {
          if (c.conectado) run(["codex", "mcp", "remove", APP]);
          const r = run(["codex", "mcp", "add", APP, "--", command, ...args]);
          resultados.push({ cliente: c.nombre, ok: r.ok, mensaje: r.ok ? "Conectado" : r.out });
          break;
        }
        case "gemini":
        case "claude-desktop": {
          const file = c.id === "gemini" ? geminiConfig() : claudeDesktopConfig();
          const cfg = leerJson(file);
          cfg.mcpServers = { ...(cfg.mcpServers ?? {}), [APP]: { command, args } };
          escribirJsonConRespaldo(file, cfg);
          resultados.push({
            cliente: c.nombre,
            ok: true,
            mensaje: c.id === "claude-desktop" ? "Conectado. Reinicia Claude Desktop para verlo." : "Conectado",
          });
          break;
        }
      }
    } catch (e) {
      resultados.push({ cliente: c.nombre, ok: false, mensaje: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!opts.dryRun) resultados.push(...instalarSkill());
  return resultados;
}

export function desconectar(): Resultado[] {
  const resultados: Resultado[] = [];
  for (const c of detectarClientes()) {
    if (!c.conectado) continue;
    try {
      if (c.id === "claude-code") run(["claude", "mcp", "remove", APP, "--scope", "user"]);
      else if (c.id === "codex") run(["codex", "mcp", "remove", APP]);
      else {
        const file = c.id === "gemini" ? geminiConfig() : claudeDesktopConfig();
        const cfg = leerJson(file);
        delete cfg.mcpServers?.[APP];
        escribirJsonConRespaldo(file, cfg);
      }
      resultados.push({ cliente: c.nombre, ok: true, mensaje: "Desconectado" });
    } catch (e) {
      resultados.push({ cliente: c.nombre, ok: false, mensaje: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const dir of skillDirs()) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
      resultados.push({ cliente: "Skill", ok: true, mensaje: `Eliminada de ${dir}` });
    }
  }
  return resultados;
}

/** Carpetas de skills de los agentes que las soportan (solo si el agente está instalado). */
function skillDirs(): string[] {
  return [join(home(), ".claude"), join(home(), ".codex")].filter(existsSync).map((d) => join(d, "skills", APP));
}

function instalarSkill(): Resultado[] {
  return skillDirs().map((dir) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), skill);
    return { cliente: "Skill", ok: true, mensaje: `Instalada en ${dir}` };
  });
}
