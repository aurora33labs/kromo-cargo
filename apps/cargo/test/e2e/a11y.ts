// Auditoría de accesibilidad (WCAG 2.2 AA) con axe-core y un navegador real.
// Recorre todas las secciones en tema Día y Noche, un panel de producto, la confirmación en dos pasos,
// el login (modo servidor) y el reflow a 320 px. Uso: bun test/e2e/a11y.ts  (CHROME_PATH opcional)
import AxeBuilder from "@axe-core/playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

const cli = resolve(import.meta.dir, "../../src/cli.ts");
const PAGES = ["venta", "productos", "entradas", "reportes", "etiquetas", "importar", "historial", "ajustes"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function arrancar(port: number, extra: Record<string, string> = {}) {
  // Un servidor viejo en el mismo puerto haría que se audite otra versión de la app.
  if (await fetch(`http://localhost:${port}/salud`).then(() => true).catch(() => false)) throw new Error(`El puerto ${port} ya está ocupado: cierra ese servidor antes de auditar.`);
  const env = { ...process.env, KROMO_DATA: mkdtempSync(join(tmpdir(), "kc-a11y-")), ...extra } as Record<string, string>;
  Bun.spawnSync([process.execPath, cli, "demo"], { env });
  return Bun.spawn([process.execPath, cli, "serve", "--no-open", "--port", String(port)], { env, stdout: "ignore", stderr: "ignore" });
}

const local = await arrancar(4710);
const servidor = await arrancar(4711, { KROMO_MODO: "servidor", KROMO_PIN_INICIAL: "24681357" });
// Docker recién instalado: sin usuarios, toca el primer registro.
const docker = await arrancar(4712, { KROMO_MODO: "servidor", KROMO_DESPLIEGUE: "docker" });
for (const port of [4710, 4711, 4712]) {
  for (let i = 0; i < 100 && !(await fetch(`http://localhost:${port}/salud`).then((r) => r.ok).catch(() => false)); i++) await Bun.sleep(100);
}

const browser = await chromium.launch({ channel: "chromium", executablePath: process.env.CHROME_PATH });
let fallas = 0;
const nuevaPagina = async (opts: Parameters<typeof browser.newContext>[0]) => (await browser.newContext(opts)).newPage();

async function auditar(page: Page, nombre: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  if (!r.violations.length) return console.log(`✓ ${nombre}`);
  fallas += r.violations.length;
  console.log(`✗ ${nombre}`);
  for (const v of r.violations) {
    console.log(`   [${v.impact}] ${v.id}: ${v.help}`);
    for (const n of v.nodes.slice(0, 4)) console.log(`      ${n.target.join(" ")}  ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`);
  }
}

try {
  for (const tema of ["light", "dark"] as const) {
    const page = await nuevaPagina({ viewport: { width: 1440, height: 900 }, colorScheme: tema });
    for (const p of PAGES) {
      await page.goto(`http://localhost:4710/#/${p}`);
      await page.waitForTimeout(600);
      await auditar(page, `${tema} · ${p}`);
    }
    // Cada pestaña de Ajustes.
    for (const tab of ["Conectar IA", "Usuarios", "Negocio"]) {
      await page.goto("http://localhost:4710/#/ajustes");
      await page.waitForTimeout(400);
      await page.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(300);
      await auditar(page, `${tema} · ajustes › ${tab}`);
    }
    const serv = await nuevaPagina({ viewport: { width: 1440, height: 900 }, colorScheme: tema });
    await serv.goto("http://localhost:4711/");
    await serv.getByLabel("Usuario").fill("dueno");
    await serv.getByLabel("Contraseña").fill("24681357");
    await serv.getByRole("button", { name: "Entrar", exact: true }).click();
    await serv.getByRole("navigation", { name: "Secciones" }).first().waitFor({ timeout: 5000 });
    await serv.goto("http://localhost:4711/#/ajustes");
    await serv.getByRole("tab", { name: "Conectar IA" }).waitFor({ timeout: 5000 });
    await serv.getByRole("tab", { name: "Conectar IA" }).click();
    await auditar(serv, `${tema} · ajustes › Conectar IA (modo servidor)`);
    await serv.getByRole("button", { name: "ChatGPT" }).click();
    await serv.locator("details.mas summary").first().click();
    await auditar(serv, `${tema} · ajustes › ChatGPT y otros agentes (modo servidor)`);
    await serv.getByRole("tab", { name: "Dominio" }).click();
    await serv.waitForTimeout(300);
    await auditar(serv, `${tema} · ajustes › Dominio (modo servidor)`);
    await serv.getByRole("tab", { name: "Usuarios" }).click();
    await serv.getByRole("button", { name: /^Editar a / }).first().click();
    await serv.waitForSelector("[role=dialog]");
    await auditar(serv, `${tema} · editar usuario`);
    await serv.keyboard.press("Escape");
    await serv.close();

    // Docker: primer registro → Conectar IA (Docker), Negocio con la tarjeta de la nube, aviso y PIN de caja.
    const dk = await nuevaPagina({ viewport: { width: 1440, height: 900 }, colorScheme: tema });
    await dk.addInitScript(() => localStorage.setItem("kromo-aviso-nube", "0"));
    await dk.goto("http://localhost:4712/");
    if (tema === "light") {
      await dk.getByRole("heading", { name: "Crea tu cuenta" }).waitFor({ timeout: 5000 });
      await auditar(dk, `${tema} · primer registro`);
      await dk.getByLabel("Tu nombre").fill("Rosa");
      await dk.getByLabel("Usuario", { exact: true }).fill("rosa");
      await dk.getByLabel("Contraseña", { exact: true }).fill("rosa-12345");
      await dk.getByLabel("Repite la contraseña").fill("rosa-12345");
      await dk.getByLabel("PIN de caja (opcional)").fill("4321");
      await dk.getByRole("button", { name: "Crear cuenta y entrar" }).click();
    } else {
      await dk.getByLabel("Usuario").fill("rosa");
      await dk.getByLabel("Contraseña").fill("rosa-12345");
      await dk.getByRole("button", { name: "Entrar", exact: true }).click();
    }
    await dk.getByRole("navigation", { name: "Secciones" }).first().waitFor({ timeout: 5000 });
    await dk.goto("http://localhost:4712/#/ajustes");
    await dk.getByRole("tab", { name: "Conectar IA" }).click();
    await dk.waitForTimeout(300);
    await auditar(dk, `${tema} · ajustes › Conectar IA (Docker) con aviso de la nube`);
    await dk.getByRole("tab", { name: "Negocio" }).click();
    await dk.waitForTimeout(300);
    await auditar(dk, `${tema} · ajustes › Negocio (Docker, tarjeta de la nube)`);
    await dk.getByRole("button", { name: "Cambiar de cajero" }).first().click();
    await dk.getByLabel("PIN de caja").waitFor({ timeout: 5000 });
    await auditar(dk, `${tema} · PIN de caja`);
    await dk.close();
    // Panel de producto abierto.
    await page.goto("http://localhost:4710/#/productos");
    await page.waitForTimeout(600);
    await page.locator("tbody tr").first().getByRole("button").first().click();
    await page.waitForSelector("[role=dialog]");
    await page.waitForTimeout(300);
    await auditar(page, `${tema} · panel de producto`);
    // Confirmación en dos pasos: conteo con un ajuste grande.
    await page.getByRole("button", { name: "Conteo" }).click();
    await page.getByLabel("Stock contado").fill("9999");
    await page.getByRole("button", { name: "Registrar" }).click();
    await page.waitForSelector("text=Confirma antes de aplicar", { timeout: 4000 }).catch(() => null);
    await auditar(page, `${tema} · confirmación`);
    await page.close();

    const login = await nuevaPagina({ viewport: { width: 1440, height: 900 }, colorScheme: tema });
    await login.goto("http://localhost:4711/");
    await login.getByLabel("Contraseña").waitFor({ timeout: 5000 }); // si la app no carga, la auditoría falla en vez de revisar una página vacía
    await auditar(login, `${tema} · login`);
    await login.close();
  }

  // Reflow (1.4.10): a 320 px de ancho no debe haber scroll horizontal de página.
  const movil = await nuevaPagina({ viewport: { width: 320, height: 640 } });
  for (const p of PAGES) {
    await movil.goto(`http://localhost:4710/#/${p}`);
    await movil.waitForTimeout(500);
    const ancho = await movil.evaluate(() => document.documentElement.scrollWidth);
    if (ancho > 320) (fallas++, console.log(`✗ reflow 320 px · ${p}: ancho ${ancho}px`));
    else console.log(`✓ reflow 320 px · ${p}`);
  }

  // Layout con flex: el contenido usa todo el ancho disponible en cada tamaño de pantalla.
  for (const ancho of [1920, 1440, 1024, 768, 390, 320]) {
    const lp = await nuevaPagina({ viewport: { width: ancho, height: 900 } });
    for (const p of PAGES) {
      await lp.goto(`http://localhost:4710/#/${p}`);
      await lp.waitForTimeout(500);
      const r = await lp.evaluate(() => {
        const errores: string[] = [];
        const main = document.querySelector<HTMLElement>(".main")!.getBoundingClientRect();
        const page = document.querySelector<HTMLElement>(".page")!;
        const pr = page.getBoundingClientRect();
        if (Math.abs(main.right - pr.right) > 1 || Math.abs(main.left - pr.left) > 1) errores.push(`.page no llena .main (${Math.round(pr.width)} de ${Math.round(main.width)} px)`);
        for (const seg of document.querySelectorAll<HTMLElement>(".seg.full")) {
          // Anchos iguales cuando caben todos al ancho del más largo; si no, flex los ajusta a su contenido.
          const botones = [...seg.querySelectorAll<HTMLElement>("button")];
          const contenido = botones.map((b) => b.scrollWidth);
          const caben = Math.max(...contenido) * botones.length <= seg.clientWidth;
          const anchos = botones.map((b) => b.getBoundingClientRect().width);
          if (caben && Math.max(...anchos) - Math.min(...anchos) > 1.5) errores.push(`botones de "${seg.getAttribute("aria-label")}" con anchos distintos`);
          const sr = seg.getBoundingClientRect();
          if ([...seg.querySelectorAll("button")].some((b) => b.getBoundingClientRect().right > sr.right + 1)) errores.push(`"${seg.getAttribute("aria-label")}" se corta`);
        }
        const grid = document.querySelector<HTMLElement>(".pgrid");
        if (grid && grid.children.length > 1) {
          const gr = grid.getBoundingClientRect();
          const items = [...grid.children].map((li) => li.getBoundingClientRect());
          const primeraFila = items.filter((i) => Math.abs(i.top - items[0]!.top) < 2);
          if (primeraFila.length < items.length && Math.abs(primeraFila.at(-1)!.right - gr.right) > 1) errores.push("la cuadrícula de productos no llena la fila");
        }
        for (const h of document.querySelectorAll<HTMLElement>(".card-head")) {
          const ico = h.querySelector(".ico");
          const h2 = h.querySelector("h2");
          if (ico && h2 && ico.getBoundingClientRect().top > h2.getBoundingClientRect().bottom) errores.push(`el ícono de "${h2.textContent}" quedó en otra línea`);
        }
        return errores;
      });
      if (r.length) (fallas += r.length, console.log(`✗ layout ${ancho} px · ${p}: ${r.join("; ")}`));
      else console.log(`✓ layout ${ancho} px · ${p}`);
    }
    if (ancho === 390) for (const p of ["productos", "historial", "venta", "ajustes"]) {
      await lp.goto(`http://localhost:4710/#/${p}`);
      await lp.waitForTimeout(500);
      await auditar(lp, `celular · ${p}`);
    }
    await lp.close();
  }

  // Texto al 200 % (1.4.4): sin scroll horizontal de página a 1280 px.
  const zoom = await nuevaPagina({ viewport: { width: 1280, height: 800 } });
  for (const p of PAGES) {
    await zoom.goto(`http://localhost:4710/#/${p}`);
    await zoom.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await zoom.waitForTimeout(400);
    const ancho = await zoom.evaluate(() => document.documentElement.scrollWidth);
    if (ancho > 1280) (fallas++, console.log(`✗ texto 200 % · ${p}: ancho ${ancho}px`));
    else console.log(`✓ texto 200 % · ${p}`);
  }

  // Solo teclado (2.1.1, 2.4.3, 2.4.1).
  const kb = await nuevaPagina({ viewport: { width: 1280, height: 800 } });
  const enfocado = () => kb.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return a ? `${a.tagName}${a.getAttribute("aria-label") ? `[${a.getAttribute("aria-label")}]` : ""} ${a.textContent?.trim().slice(0, 40) ?? ""}` : "";
  });
  const paso = async (cond: unknown, msg: string) => (cond ? console.log(`✓ teclado · ${msg}`) : (fallas++, console.log(`✗ teclado · ${msg} (foco: ${await enfocado()})`)));

  await kb.goto("http://localhost:4710/#/productos");
  await kb.waitForTimeout(600);
  await kb.keyboard.press("Tab");
  await paso(await kb.evaluate(() => document.activeElement?.classList.contains("skip")), "el primer Tab llega a «Saltar al contenido»");
  await kb.keyboard.press("Enter");
  await paso(await kb.evaluate(() => document.activeElement?.id === "contenido"), "«Saltar al contenido» mueve el foco al contenido");

  const nuevo = kb.getByRole("button", { name: "Nuevo producto" });
  await nuevo.focus();
  await kb.keyboard.press("Enter");
  await kb.waitForSelector("[role=dialog]");
  await paso(await kb.evaluate(() => !!document.activeElement?.closest("[role=dialog]")), "al abrir el panel, el foco entra al diálogo");
  for (let i = 0; i < 40; i++) await kb.keyboard.press("Tab");
  await paso(await kb.evaluate(() => !!document.activeElement?.closest("[role=dialog]")), "Tab no se sale del diálogo (foco atrapado)");
  await kb.keyboard.press("Escape");
  await kb.waitForTimeout(200);
  await paso((await kb.locator("[role=dialog]").count()) === 0 && (await kb.evaluate(() => document.activeElement?.textContent?.includes("Nuevo producto"))), "Esc cierra y el foco regresa al botón que lo abrió");

  const primerNombre = kb.locator("tbody .linklike").first();
  await primerNombre.focus();
  await kb.keyboard.press("Enter");
  await paso(await kb.locator("[role=dialog]").count(), "un producto de la tabla se abre con Enter");
  await kb.keyboard.press("Escape");

  await kb.goto("http://localhost:4710/#/venta");
  await kb.waitForTimeout(600);
  await paso(await kb.evaluate(() => document.activeElement?.id === "venta-buscar"), "Venta rápida enfoca el buscador al entrar");
  await kb.keyboard.type("7501055300075");
  await kb.keyboard.press("Enter");
  await kb.waitForSelector(".cline");
  await kb.keyboard.press("F9");
  const deshacer = kb.getByRole("button", { name: "Deshacer" });
  await deshacer.waitFor();
  await kb.waitForTimeout(7000);
  await paso(await deshacer.isVisible(), "el aviso con «Deshacer» no desaparece solo (2.2.1)");
  await deshacer.focus();
  await kb.keyboard.press("Enter");
  await kb.waitForSelector("text=Listo, se deshizo.");
  await paso(true, "la venta se deshace desde el aviso con el teclado");

  await kb.goto("http://localhost:4710/#/reportes");
  await kb.waitForTimeout(800);
  await kb.locator(".bars").focus();
  await kb.keyboard.press("End");
  await paso((await kb.locator(".chart [aria-live]").innerText()).includes("$"), "la gráfica se recorre con flechas y anuncia el día");

  await kb.goto("http://localhost:4710/#/importar");
  await kb.waitForTimeout(500);
  await kb.getByLabel("Elegir archivo CSV o Excel para importar").focus();
  await paso(await kb.evaluate(() => (document.activeElement as HTMLInputElement)?.type === "file"), "el selector de archivo para importar recibe foco");
} finally {
  await browser.close();
  local.kill();
  servidor.kill();
  docker.kill();
}
console.log(fallas ? `\n${fallas} problemas` : "\nSin violaciones WCAG 2.2 AA detectadas");
process.exit(fallas ? 1 : 0);
