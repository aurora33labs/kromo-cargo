#!/bin/sh
# Instalador de Kromo Cargo para macOS y Linux.
# - Descarga el ejecutable del último release y verifica su SHA-256.
# - Lo instala en ~/.local/bin (sin sudo).
# - Lo conecta a los clientes de IA que encuentre (Claude Code, Codex, Gemini CLI, Claude Desktop).
# Variables opcionales: KROMO_RELEASES_URL, KROMO_BIN_DIR, KROMO_NO_CONECTAR=1
set -eu

REPO="${KROMO_REPO:-aurora33labs/kromo-cargo}"
BASE="${KROMO_RELEASES_URL:-https://github.com/$REPO/releases/latest/download}"
BIN_DIR="${KROMO_BIN_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "Sistema no soportado: $(uname -s). En Windows usa cargo.ps1" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "Arquitectura no soportada: $(uname -m)" ;;
esac
asset="kromo-cargo-$os-$arch"

if command -v curl >/dev/null 2>&1; then get() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then get() { wget -q "$1" -O "$2"; }
else fail "Necesito curl o wget."; fi

if command -v sha256sum >/dev/null 2>&1; then sha() { sha256sum "$1" | cut -d' ' -f1; }
else sha() { shasum -a 256 "$1" | cut -d' ' -f1; }; fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say "→ Descargando $asset…"
get "$BASE/$asset" "$tmp/$asset" || fail "No pude descargar $BASE/$asset"
get "$BASE/checksums.txt" "$tmp/checksums.txt" || fail "No pude descargar checksums.txt"

esperado="$(grep " \*\{0,1\}$asset\$" "$tmp/checksums.txt" | cut -d' ' -f1)"
real="$(sha "$tmp/$asset")"
[ -n "$esperado" ] && [ "$esperado" = "$real" ] || fail "El checksum no coincide. No se instaló nada."
say "✓ Checksum verificado ($real)"

mkdir -p "$BIN_DIR"
mv "$tmp/$asset" "$BIN_DIR/kromo-cargo"
chmod 755 "$BIN_DIR/kromo-cargo"
say "✓ Instalado en $BIN_DIR/kromo-cargo ($("$BIN_DIR/kromo-cargo" version))"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "! $BIN_DIR no está en tu PATH. Agrégalo para usar el comando 'kromo-cargo' directamente." ;;
esac

if [ "${KROMO_NO_CONECTAR:-0}" != "1" ]; then
  say "→ Conectando con tus clientes de IA…"
  "$BIN_DIR/kromo-cargo" conectar || say "! No encontré clientes de IA. Puedes conectarlos después con: kromo-cargo conectar"
fi

say ""
"$BIN_DIR/kromo-cargo" doctor || true
say ""
say "Listo. Abre la app con:  kromo-cargo serve"
