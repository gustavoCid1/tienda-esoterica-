<#
.SYNOPSIS
  Respaldo diario de la base de datos de Esoterica Amara (lo lanza la tarea programada de Windows).

.DESCRIPTION
  1) Intenta hacerlo con la propia aplicacion:  "Esoterica Amara.exe" --backup-now
     La app hace una copia consistente (VACUUM INTO), la verifica (PRAGMA integrity_check),
     la guarda con fecha y hora, rota las viejas y copia al segundo destino si esta configurado.
     Si la app ya esta abierta, la segunda instancia le pasa la orden a la primera y termina:
     por eso despues se COMPRUEBA que aparezca un respaldo nuevo.
  2) Si la app no esta o no genero el respaldo, usa sqlite3.exe (si existe en el PATH o junto a la
     app) con VACUUM INTO + integrity_check.
  3) Todo queda en %APPDATA%\Esoterica Amara\logs\respaldo-diario.log. Codigo de salida 0 = ok.

  Uso manual:
    powershell -ExecutionPolicy Bypass -File respaldo-diario.ps1
    powershell -ExecutionPolicy Bypass -File respaldo-diario.ps1 -ExePath "D:\Amara\Esoterica Amara.exe"

  NOTA: NO se ha probado en un Windows real. Archivo solo ASCII a proposito.
#>
[CmdletBinding()]
param(
    [string]$ExePath = '',
    [string]$Sqlite3Path = '',
    [int]$EsperaSegundos = 180
)

$ErrorActionPreference = 'Stop'

$DataDir = Join-Path $env:APPDATA 'Esoterica Amara'
$Db = Join-Path $DataDir 'amara.sqlite'
$LogDir = Join-Path $DataDir 'logs'
$LogFile = Join-Path $LogDir 'respaldo-diario.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Log([string]$msg) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

# --- Configuracion de la app (carpeta de respaldos y segundo destino) ---
$BackupDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Esoterica Amara\Respaldos'
$Secundario = ''
$ConfigPath = Join-Path $DataDir 'config.json'
if (Test-Path -LiteralPath $ConfigPath) {
    try {
        $cfg = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.backupDir) { $BackupDir = [string]$cfg.backupDir }
        if ($cfg.backupSecondaryDir) { $Secundario = [string]$cfg.backupSecondaryDir }
    } catch {
        Log "Aviso: no se pudo leer config.json ($($_.Exception.Message)); se usa la carpeta por omision."
    }
}

if (-not (Test-Path -LiteralPath $Db)) {
    Log "No existe la base de datos en $Db. Nada que respaldar."
    exit 0
}

# --- Localizar el ejecutable de la app ---
function Find-Exe {
    $candidatos = @()
    if ($ExePath) { $candidatos += $ExePath }
    # Instalada con NSIS: <instalacion>\resources\scripts\respaldo-diario.ps1 -> <instalacion>\Esoterica Amara.exe
    $candidatos += (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'Esoterica Amara.exe')
    $candidatos += (Join-Path $env:LOCALAPPDATA 'Programs\Esoterica Amara\Esoterica Amara.exe')
    if ($env:ProgramFiles) { $candidatos += (Join-Path $env:ProgramFiles 'Esoterica Amara\Esoterica Amara.exe') }
    foreach ($c in $candidatos) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
    return $null
}

function Newest-Backup([string]$dir, [datetime]$desde) {
    if (-not (Test-Path -LiteralPath $dir)) { return $null }
    return Get-ChildItem -LiteralPath $dir -Filter 'amara_*.sqlite' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -ge $desde } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

$inicio = (Get-Date).AddSeconds(-2)
$ok = $false

# --- 1) Respaldo con la aplicacion ---
$exe = Find-Exe
if ($exe) {
    Log "Respaldo con la aplicacion: $exe --backup-now"
    try {
        $p = Start-Process -FilePath $exe -ArgumentList '--backup-now' -PassThru -Wait -WindowStyle Hidden
        Log "La aplicacion termino con codigo $($p.ExitCode)."
    } catch {
        Log "No se pudo ejecutar la aplicacion: $($_.Exception.Message)"
    }
    # Si la app ya estaba abierta, la orden la ejecuta la instancia abierta: esperar a que aparezca el archivo.
    $limite = (Get-Date).AddSeconds($EsperaSegundos)
    do {
        $nuevo = Newest-Backup $BackupDir $inicio
        if ($nuevo) { break }
        Start-Sleep -Seconds 5
    } while ((Get-Date) -lt $limite)
    if ($nuevo) {
        Log "Respaldo OK: $($nuevo.FullName) ($([math]::Round($nuevo.Length / 1MB, 2)) MB)"
        $ok = $true
    } else {
        Log "La aplicacion no genero un respaldo nuevo en $BackupDir."
    }
} else {
    Log 'No se encontro el ejecutable de la aplicacion.'
}

# --- 2) Plan B: sqlite3.exe ---
if (-not $ok) {
    $sqlite = $Sqlite3Path
    if (-not $sqlite) {
        $cmd = Get-Command 'sqlite3.exe' -ErrorAction SilentlyContinue
        if ($cmd) { $sqlite = $cmd.Source }
        elseif ($exe -and (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $exe) 'sqlite3.exe'))) { $sqlite = Join-Path (Split-Path -Parent $exe) 'sqlite3.exe' }
    }
    if ($sqlite -and (Test-Path -LiteralPath $sqlite)) {
        try {
            New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
            # Mismo nombre que usa la app (hora de Mexico, UTC-6 fijo) para que la rotacion lo reconozca.
            $stamp = [DateTime]::UtcNow.AddHours(-6).ToString('yyyy-MM-dd_HH-mm-ss')
            $final = Join-Path $BackupDir "amara_$stamp.sqlite"
            $parcial = "$final.partial"
            if (Test-Path -LiteralPath $parcial) { Remove-Item -LiteralPath $parcial -Force }
            $dest = $parcial.Replace("'", "''")
            Log "Respaldo con sqlite3: $sqlite"
            & $sqlite -cmd '.timeout 10000' $Db "VACUUM INTO '$dest'" | Out-Null
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $parcial)) { throw "sqlite3 devolvio el codigo $LASTEXITCODE" }
            $chk = (& $sqlite $parcial 'PRAGMA integrity_check;') -join ''
            if ($chk.Trim() -ne 'ok') {
                Remove-Item -LiteralPath $parcial -Force
                throw "La copia no paso integrity_check: $chk"
            }
            Move-Item -LiteralPath $parcial -Destination $final
            Log "Respaldo OK (sqlite3): $final"
            $ok = $true
            if ($Secundario) {
                try {
                    New-Item -ItemType Directory -Force -Path $Secundario | Out-Null
                    Copy-Item -LiteralPath $final -Destination (Join-Path $Secundario (Split-Path -Leaf $final)) -Force
                    Log "Copia al segundo destino OK: $Secundario"
                } catch {
                    Log "AVISO: fallo la copia al segundo destino ($Secundario): $($_.Exception.Message)"
                }
            }
        } catch {
            Log "Fallo el respaldo con sqlite3: $($_.Exception.Message)"
        }
    } else {
        Log 'No hay sqlite3.exe disponible para el plan B.'
    }
}

if ($ok) { exit 0 }
Log 'RESPALDO DIARIO FALLIDO. Revisar la carpeta de respaldos, el espacio en disco y el log.'
exit 1
