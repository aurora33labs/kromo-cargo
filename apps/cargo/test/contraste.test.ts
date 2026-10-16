// Verifica que los tokens de color de la UI cumplan el contraste WCAG 2.2 AA en ambos temas.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(import.meta.dir, "../src/ui/styles.css"), "utf8");

function tokens(selector: string): Record<string, string> {
  const i = css.indexOf(selector);
  const bloque = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return Object.fromEntries([...bloque.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
}

const luminancia = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
export const contraste = (a: string, b: string) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

const dia = tokens(":root {");
const noche = { ...dia, ...tokens(':root[data-theme="dark"] {') };

// [texto, fondo, mínimo]. 4.5 = texto normal (1.4.3); 3 = bordes de controles, foco y marcas de gráficas (1.4.11).
const PARES: [string, string, number][] = [
  ...["bg", "surface", "surface-2"].flatMap((f): [string, string, number][] => [
    ["text", f, 4.5],
    ["text-2", f, 4.5],
    ["accent-strong", f, 4.5],
    ["bad-text", f, 4.5],
    ["border-input", f, 3],
    ["focus", f, 3],
    ["series-1", f, 3],
  ]),
  ["accent-strong", "accent-soft", 4.5],
  ["text", "accent-soft", 4.5],
  ["on-accent", "accent", 4.5],
  ["on-accent", "accent-hover", 4.5],
  ["good", "good-soft", 4.5],
  ["warn", "warn-soft", 4.5],
  ["bad-text", "bad-soft", 4.5],
  ["ia", "ia-soft", 4.5],
  ["ia", "surface", 3],
  ["good", "surface", 3],
  ["surface", "text", 4.5], // tooltip de la gráfica
];

for (const [nombre, t] of [["Día", dia], ["Noche", noche]] as const) {
  describe(`contraste WCAG · tema ${nombre}`, () => {
    for (const [a, b, min] of PARES) {
      test(`--${a} sobre --${b} ≥ ${min}:1`, () => {
        expect(t[a], `falta --${a}`).toBeDefined();
        expect(t[b], `falta --${b}`).toBeDefined();
        expect(Number(contraste(t[a]!, t[b]!).toFixed(2))).toBeGreaterThanOrEqual(min);
      });
    }
  });
}

test("el tema Noche por preferencia del sistema es idéntico al de data-theme", () => {
  const i = css.indexOf("@media (prefers-color-scheme: dark)");
  const pref = tokens(css.slice(i, i + 200).includes(':root:not([data-theme="light"])') ? ':root:not([data-theme="light"]) {' : "@@");
  expect(pref).toEqual(tokens(':root[data-theme="dark"] {'));
});
