import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Directorio de datos por sistema operativo. Se puede forzar con la variable
 * de entorno `envVar` (p. ej. KROMO_DATA).
 */
export function dataDir(app: string, envVar: string): string {
  const override = process.env[envVar];
  if (override) return override;
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", app);
    case "win32":
      return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), app);
    default:
      return join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), app);
  }
}
