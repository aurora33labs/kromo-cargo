import { ActionError, defineAction } from "@kromo/core";
import bwipjs from "bwip-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { z } from "zod";
import { hoy, money } from "../lib.ts";
import { listarProductos, norm } from "./productos.ts";

// Hoja carta con 30 etiquetas de 2.625" × 1" (formato tipo Avery 5160), en puntos.
const PAGE = { w: 612, h: 792 };
const LABEL = { w: 189, h: 72, cols: 3, rows: 10, left: 13.5, top: 36, gapX: 9 };

/** pdf-lib con fuentes estándar solo codifica Latin-1 (incluye acentos y ñ). */
const latin1 = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

function wrap(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
  const words = latin1(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) line = test;
    else {
      if (line) lines.push(line);
      line = w;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) {
    let last = lines[maxLines - 1]!;
    while (last.length > 1 && font.widthOfTextAtSize(last + "…", size) > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "…";
  }
  return lines;
}

export const generarEtiquetas = defineAction({
  name: "generar_etiquetas",
  title: "Generar etiquetas",
  description:
    "Genera un PDF imprimible (hoja carta, 30 etiquetas) con QR o código de barras, nombre y precio. Elige productos por ids, categoría o 'solo_entradas_de_hoy'. Regresa la ruta del PDF.",
  kind: "accion",
  input: z.object({
    ids: z.array(z.number().int()).optional(),
    categoria: z.string().optional(),
    solo_entradas_de_hoy: z.boolean().default(false).describe("Productos que recibieron mercancía hoy"),
    tipo: z.enum(["qr", "barras"]).default("qr"),
    copias: z.number().int().min(1).max(100).default(1).describe("Etiquetas por producto"),
    mostrar_precio: z.boolean().default(true),
  }),
  run: async (i, { db, dataDir, setResumen, urlArchivo }) => {
    let productos = await listarProductos(db);
    if (i.ids?.length) productos = productos.filter((p) => i.ids!.includes(p.id));
    if (i.categoria) productos = productos.filter((p) => norm(p.categoria) === norm(i.categoria));
    if (i.solo_entradas_de_hoy) {
      const rows = await db.all<{ producto_id: number }>(
        "SELECT DISTINCT producto_id FROM movimientos WHERE tipo IN ('entrada','inicial') AND creado_en >= ?",
        [hoy(0) + " 00:00:00"],
      );
      const deHoy = new Set(rows.map((r) => Number(r.producto_id)));
      productos = productos.filter((p) => deHoy.has(p.id));
    }
    if (!productos.length) throw new ActionError("No hay productos que coincidan para generar etiquetas.");

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const cola = productos.flatMap((p) => Array.from({ length: i.copias }, () => p));
    const porPagina = LABEL.cols * LABEL.rows;
    const imgCache = new Map<number, Awaited<ReturnType<typeof pdf.embedPng>>>();

    for (let n = 0; n < cola.length; n++) {
      const page = n % porPagina === 0 ? pdf.addPage([PAGE.w, PAGE.h]) : pdf.getPages().at(-1)!;
      const p = cola[n]!;
      const slot = n % porPagina;
      const x = LABEL.left + (slot % LABEL.cols) * (LABEL.w + LABEL.gapX);
      const y = PAGE.h - LABEL.top - (Math.floor(slot / LABEL.cols) + 1) * LABEL.h;
      const codigo = p.codigo_barras || p.sku || String(p.id);

      let img = imgCache.get(p.id);
      if (!img) {
        const png =
          i.tipo === "qr"
            ? await bwipjs.toBuffer({ bcid: "qrcode", text: codigo, scale: 4 })
            : await bwipjs.toBuffer({ bcid: "code128", text: codigo, scale: 3, height: 9, includetext: true, textsize: 9 });
        img = await pdf.embedPng(png);
        imgCache.set(p.id, img);
      }

      const pad = 6;
      if (i.tipo === "qr") {
        const s = LABEL.h - pad * 2;
        page.drawImage(img, { x: x + pad, y: y + pad, width: s, height: s });
        const tx = x + pad + s + 6;
        const tw = LABEL.w - (tx - x) - pad;
        const lines = wrap(p.nombre, bold, 8.5, tw, 3);
        lines.forEach((l, k) => page.drawText(l, { x: tx, y: y + LABEL.h - pad - 9 - k * 10, size: 8.5, font: bold }));
        if (i.mostrar_precio) page.drawText(latin1(money(p.precio)), { x: tx, y: y + pad + 10, size: 13, font: bold });
        page.drawText(latin1(codigo), { x: tx, y: y + pad, size: 6.5, font, color: rgb(0.35, 0.35, 0.35) });
      } else {
        const bw = LABEL.w - pad * 2;
        const bh = 34;
        page.drawImage(img, { x: x + pad, y: y + pad, width: bw, height: bh });
        const nombre = wrap(p.nombre, bold, 8, bw - (i.mostrar_precio ? 55 : 0), 2);
        nombre.forEach((l, k) => page.drawText(l, { x: x + pad, y: y + LABEL.h - pad - 8 - k * 9.5, size: 8, font: bold }));
        if (i.mostrar_precio) {
          const precio = latin1(money(p.precio));
          page.drawText(precio, { x: x + LABEL.w - pad - bold.widthOfTextAtSize(precio, 12), y: y + LABEL.h - pad - 11, size: 12, font: bold });
        }
      }
    }

    const dir = join(dataDir, "etiquetas");
    mkdirSync(dir, { recursive: true });
    const nombre = `etiquetas-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
    writeFileSync(join(dir, nombre), await pdf.save());
    setResumen(`Generó ${cola.length} etiquetas (${i.tipo}) de ${productos.length} productos`);
    return { ruta: join(dir, nombre), url: urlArchivo(`/archivos/etiquetas/${nombre}`), etiquetas: cola.length, paginas: pdf.getPageCount() };
  },
});
