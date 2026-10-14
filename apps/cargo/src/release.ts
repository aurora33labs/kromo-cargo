import { chmodSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { VERSION } from "./app.ts";
import { isCompiled } from "./server.ts";

/** Repositorio de GitHub donde se publican los releases. Cámbialo al publicar. */
export const REPO = process.env.KROMO_REPO ?? "aurora33labs/kromo-cargo";

export const releasesBase = () =>
  process.env.KROMO_RELEASES_URL ?? `https://github.com/${REPO}/releases/latest/download`;

/** Nombre del binario publicado para esta plataforma, p. ej. kromo-cargo-linux-x64. */
export function assetName(platform = process.platform, arch = process.arch): string {
  const os = platform === "win32" ? "windows" : platform;
  return `kromo-cargo-${os}-${arch}${platform === "win32" ? ".exe" : ""}`;
}

const cmpVersion = (a: string, b: string) => {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

export async function ultimaVersion(): Promise<string> {
  const r = await fetch(`${releasesBase()}/version.txt`);
  if (!r.ok) throw new Error(`No pude consultar la última versión (${r.status}).`);
  return (await r.text()).trim();
}

/** Descarga la última versión, verifica su SHA-256 y reemplaza el ejecutable actual. */
export async function actualizar(opts: { forzar?: boolean } = {}): Promise<string> {
  if (!isCompiled) throw new Error("Solo el ejecutable instalado se puede actualizar (estás en modo desarrollo).");
  const ultima = await ultimaVersion();
  if (!opts.forzar && cmpVersion(ultima, VERSION) <= 0) return `Ya tienes la última versión (${VERSION}).`;

  const asset = assetName();
  const [bin, sums] = await Promise.all([fetch(`${releasesBase()}/${asset}`), fetch(`${releasesBase()}/checksums.txt`)]);
  if (!bin.ok || !sums.ok) throw new Error("No pude descargar el ejecutable o sus checksums.");
  const data = new Uint8Array(await bin.arrayBuffer());
  const esperado = (await sums.text())
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find(([, name]) => name?.replace(/^\*/, "") === asset)?.[0];
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  const real = hasher.digest("hex");
  if (!esperado || esperado.toLowerCase() !== real) throw new Error("El checksum no coincide: la descarga se descartó por seguridad.");

  const actual = process.execPath;
  const nuevo = `${actual}.nuevo`;
  writeFileSync(nuevo, data);
  if (process.platform !== "win32") chmodSync(nuevo, 0o755);
  if (process.platform === "win32") {
    const viejo = `${actual}.anterior`;
    if (existsSync(viejo)) rmSync(viejo);
    renameSync(actual, viejo); // Windows permite renombrar un .exe en uso, no sobrescribirlo
  }
  renameSync(nuevo, actual);
  return `Actualizado de ${VERSION} a ${ultima}. Reinicia la app y tus clientes de IA para usar la nueva versión.`;
}
