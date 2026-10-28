<#
.SYNOPSIS
  Restaura la base de datos de Esoterica Amara desde un respaldo, SIN perder la base actual.

.DESCRIPTION
  Seguridad: antes de tocar nada se COPIA la base actual (con sus archivos -wal y -shm) a
  %APPDATA%\Esoterica Amara\antes-de-restaurar\amara-<fecha>\ y se comprueba que la copia quedo
  completa. Si esa copia falla, el script se detiene y NO restaura. Tambien se borran el -wal y
  el -shm viejos: un WAL antiguo aplicado sobre otra base la corromperia.

  Requisitos: la aplicacion debe estar CERRADA.

  Uso:
    powershell -ExecutionPolicy Bypass -File restaurar-respaldo.ps1                 (elige de una lista)
    powershell -ExecutionPolicy Bypass -File restaurar-respaldo.ps1 -Respaldo "D:\resp\amara_2026-10-22_13-45-10.sqlite"
    ... -Forzar     (omite la pregunta de confirmacion; la copia previa NO se omite nunca)

  NOTA: NO se ha probado en un Windows real. Archivo solo ASCII a proposito.
#>
[CmdletBinding()]
param(
    [string]$Respaldo = '',
    [string]$Sqlite3Path = '',
    [switch]$Forzar
)

$ErrorActionPreference = 'Stop'

$DataDir = Join-Path $env:APPDATA 'Esoterica Amara'
$Db = Join-Path $DataDir 'amara.sqlite'
$LogDir = Join-Path $DataDir 'logs'
$LogFile = Join-Path $LogDir 'restauracion.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Log([string]$msg) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

# --- La app debe estar cerrada ---
$procs = Get-Process -Name 'Esoterica Amara' -ErrorAction SilentlyContinue
if ($procs) {
    Write-Host 'La aplicacion Esoterica Amara esta abierta. Cierrala y vuelve a ejecutar este script.' -ForegroundColor Yellow
    exit 2
}

# --- Carpetas de respaldo conocidas ---
$dirs = @()
$ConfigPath = Join-Path $DataDir 'config.json'
if (Test-Path -LiteralPath $ConfigPath) {
    try {
        $cfg = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.backupDir) { $dirs += [string]$cfg.backupDir }
        if ($cfg.backupSecondaryDir) { $dirs += [string]$cfg.backupSecondaryDir }
    } catch { }
}
$dirs += (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Esoterica Amara\Respaldos')
$dirs += (Join-Path $DataDir 'respaldos-internos')
$dirs = $dirs | Where-Object { $_ } | Select-Object -Unique

# --- Elegir respaldo ---
if (-not $Respaldo) {
    $lista = @()
    foreach ($d in $dirs) {
        if (Test-Path -LiteralPath $d) {
            $lista += Get-ChildItem -LiteralPath $d -Filter 'amara_*.sqlite' -File -ErrorAction SilentlyContinue
        }
    }
    $lista = $lista | Sort-Object LastWriteTime -Descending | Select-Object -First 30
    if (-not $lista) { Write-Host 'No se encontraron respaldos en las carpetas conocidas. Usa -Respaldo <ruta>.' -ForegroundColor Red; exit 1 }
    Write-Host 'Respaldos disponibles (del mas reciente al mas antiguo):'
    for ($i = 0; $i -lt $lista.Count; $i++) {
        Write-Host ('  [{0}] {1}  {2}  {3} MB' -f ($i + 1), $lista[$i].Name, $lista[$i].DirectoryName, [math]::Round($lista[$i].Length / 1MB, 2))
    }
    $n = Read-Host 'Numero del respaldo a restaurar (Enter para cancelar)'
    if (-not $n) { Write-Host 'Cancelado.'; exit 0 }
    $idx = 0
    if (-not [int]::TryParse($n, [ref]$idx) -or $idx -lt 1 -or $idx -gt $lista.Count) { Write-Host 'Opcion no valida.' -ForegroundColor Red; exit 1 }
    $Respaldo = $lista[$idx - 1].FullName
}
if (-not (Test-Path -LiteralPath $Respaldo)) { Write-Host "No existe el archivo: $Respaldo" -ForegroundColor Red; exit 1 }

# --- Verificar el respaldo (si hay sqlite3) ---
$sqlite = $Sqlite3Path
if (-not $sqlite) { $cmd = Get-Command 'sqlite3.exe' -ErrorAction SilentlyContinue; if ($cmd) { $sqlite = $cmd.Source } }
if ($sqlite -and (Test-Path -LiteralPath $sqlite)) {
    $chk = (& $sqlite -readonly $Respaldo 'PRAGMA integrity_check;') -join ''
    if ($chk.Trim() -ne 'ok') { Write-Host "El respaldo NO paso integrity_check: $chk" -ForegroundColor Red; exit 1 }
    Log "El respaldo paso integrity_check: $Respaldo"
} else {
    Write-Host 'AVISO: no hay sqlite3.exe para verificar el respaldo antes de restaurar.' -ForegroundColor Yellow
    Write-Host 'La aplicacion lo verificara al abrir; la base actual se conserva en la copia de seguridad.' -ForegroundColor Yellow
}

# --- Confirmacion ---
if (-not $Forzar) {
    Write-Host ''
    Write-Host "Se reemplazara la base actual:  $Db"
    Write-Host "Por el respaldo:               $Respaldo"
    Write-Host 'La base actual se copiara ANTES a una carpeta de seguridad. Lo vendido despues de ese respaldo, y no sincronizado, se perdera de esta base.'
    $r = Read-Host 'Escribe RESTAURAR para continuar'
    if ($r -ne 'RESTAURAR') { Write-Host 'Cancelado. No se cambio nada.'; exit 0 }
}

# --- 1) Copiar la base actual (NUNCA se sobrescribe sin copiar antes) ---
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$seguridad = Join-Path $DataDir "antes-de-restaurar\amara-$stamp"
if (Test-Path -LiteralPath $Db) {
    New-Item -ItemType Directory -Force -Path $seguridad | Out-Null
    foreach ($suffix in @('', '-wal', '-shm')) {
        $src = "$Db$suffix"
        if (Test-Path -LiteralPath $src) {
            $dst = Join-Path $seguridad (Split-Path -Leaf $src)
            Copy-Item -LiteralPath $src -Destination $dst -Force
            if ((Get-Item -LiteralPath $src).Length -ne (Get-Item -LiteralPath $dst).Length) {
                Write-Host "La copia de seguridad de $src quedo incompleta. NO se restaura nada." -ForegroundColor Red
                Log "ABORTADO: copia de seguridad incompleta de $src"
                exit 1
            }
        }
    }
    Log "Base actual copiada a: $seguridad"
} else {
    Log 'No habia base actual; se restaura sobre una instalacion limpia.'
}

# --- 2) Restaurar ---
try {
    $tmp = "$Db.restaurando"
    Copy-Item -LiteralPath $Respaldo -Destination $tmp -Force
    # Quitar el WAL/SHM viejos: no deben aplicarse sobre la base restaurada.
    foreach ($suffix in @('-wal', '-shm')) { if (Test-Path -LiteralPath "$Db$suffix") { Remove-Item -LiteralPath "$Db$suffix" -Force } }
    Move-Item -LiteralPath $tmp -Destination $Db -Force
    Log "Restauracion completada desde: $Respaldo"
    Write-Host ''
    Write-Host 'Listo. Abre la aplicacion. Si algo sale mal, la base anterior esta en:' -ForegroundColor Green
    Write-Host "  $seguridad"
    exit 0
} catch {
    Log "ERROR al restaurar: $($_.Exception.Message). La base anterior esta en $seguridad"
    Write-Host "Error al restaurar: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "La base anterior esta intacta en: $seguridad" -ForegroundColor Yellow
    exit 1
}
