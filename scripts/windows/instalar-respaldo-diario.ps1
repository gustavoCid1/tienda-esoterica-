<#
.SYNOPSIS
  Registra (o quita) la tarea programada de Windows que hace el respaldo DIARIO de Esoterica Amara.

.DESCRIPTION
  Crea la tarea "Esoterica Amara - Respaldo diario" que ejecuta respaldo-diario.ps1 cada dia.
  Usa StartWhenAvailable: si la PC estaba apagada a la hora programada, la tarea corre en cuanto
  sea posible (al encender / iniciar sesion), asi los respaldos omitidos se recuperan.
  Se ejecuta como el usuario actual (la base de datos vive en su %APPDATA%), sin pedir contrasena.

  Este script lo ejecuta el instalador (NSIS) y tambien se puede correr a mano:
    powershell -ExecutionPolicy Bypass -File instalar-respaldo-diario.ps1
    powershell -ExecutionPolicy Bypass -File instalar-respaldo-diario.ps1 -Hora 22:15
    powershell -ExecutionPolicy Bypass -File instalar-respaldo-diario.ps1 -Quitar

  NOTA: NO se ha probado en un Windows real (escrito sin poder ejecutarlo). Probar antes de entregar.
  NOTA: este archivo es solo ASCII a proposito (PowerShell 5.1 lee mal los acentos sin BOM).
#>
[CmdletBinding()]
param(
    [string]$Hora = '21:30',
    [string]$NombreTarea = 'Esoterica Amara - Respaldo diario',
    [switch]$Quitar,
    [switch]$Silencioso
)

$ErrorActionPreference = 'Stop'

function Say([string]$msg) { if (-not $Silencioso) { Write-Host $msg } }

try {
    if ($Quitar) {
        if (Get-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $NombreTarea -Confirm:$false
            Say "Tarea '$NombreTarea' eliminada."
        } else {
            Say "La tarea '$NombreTarea' no existe."
        }
        exit 0
    }

    $script = Join-Path $PSScriptRoot 'respaldo-diario.ps1'
    if (-not (Test-Path -LiteralPath $script)) { throw "No se encontro $script" }

    $argumentos = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $script
    $accion = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argumentos

    $disparador = New-ScheduledTaskTrigger -Daily -At $Hora

    # StartWhenAvailable = recupera respaldos omitidos; IgnoreNew = nunca dos respaldos a la vez.
    $ajustes = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 5)

    $usuario = "$env:USERDOMAIN\$env:USERNAME"
    $principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask -TaskName $NombreTarea `
        -Action $accion -Trigger $disparador -Settings $ajustes -Principal $principal `
        -Description 'Respaldo diario verificado de la base de datos de Esoterica Amara (recupera omitidos al encender la PC).' `
        -Force | Out-Null

    Say "Tarea '$NombreTarea' registrada: todos los dias a las $Hora (y al encender la PC si se omitio)."
    Say "Para probarla ahora: Start-ScheduledTask -TaskName '$NombreTarea'"
    exit 0
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
