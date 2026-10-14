# Instalador de Kromo Cargo para Windows (PowerShell 5+).
# - Descarga el ejecutable del último release y verifica su SHA-256.
# - Lo instala en %LOCALAPPDATA%\Programs\kromo-cargo (sin permisos de administrador).
# - Lo conecta a los clientes de IA que encuentre.
$ErrorActionPreference = "Stop"

$Repo = if ($env:KROMO_REPO) { $env:KROMO_REPO } else { "aurora33labs/kromo-cargo" }
$Base = if ($env:KROMO_RELEASES_URL) { $env:KROMO_RELEASES_URL } else { "https://github.com/$Repo/releases/latest/download" }
$BinDir = if ($env:KROMO_BIN_DIR) { $env:KROMO_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "Programs\kromo-cargo" }

$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { throw "Se requiere Windows de 64 bits." }
$asset = "kromo-cargo-windows-$arch.exe"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
  Write-Host "→ Descargando $asset…"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest "$Base/$asset" -OutFile (Join-Path $tmp $asset) -UseBasicParsing
  Invoke-WebRequest "$Base/checksums.txt" -OutFile (Join-Path $tmp "checksums.txt") -UseBasicParsing

  $line = Get-Content (Join-Path $tmp "checksums.txt") | Where-Object { $_ -match "\s\*?$([regex]::Escape($asset))$" } | Select-Object -First 1
  if (-not $line) { throw "No encontré el checksum de $asset." }
  $esperado = ($line -split "\s+")[0].ToLower()
  $real = (Get-FileHash (Join-Path $tmp $asset) -Algorithm SHA256).Hash.ToLower()
  if ($esperado -ne $real) { throw "El checksum no coincide. No se instaló nada." }
  Write-Host "✓ Checksum verificado ($real)"

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $exe = Join-Path $BinDir "kromo-cargo.exe"
  Move-Item -Force (Join-Path $tmp $asset) $exe
  Write-Host "✓ Instalado en $exe ($(& $exe version))"

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (($userPath -split ";") -notcontains $BinDir) {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$BinDir", "User")
    $env:Path = "$env:Path;$BinDir"
    Write-Host "✓ Agregado a tu PATH (abre una terminal nueva para usar 'kromo-cargo')"
  }

  if ($env:KROMO_NO_CONECTAR -ne "1") {
    Write-Host "→ Conectando con tus clientes de IA…"
    & $exe conectar
  }
  & $exe doctor
  Write-Host "`nListo. Abre la app con:  kromo-cargo serve"
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
