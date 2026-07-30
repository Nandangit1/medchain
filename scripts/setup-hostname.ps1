<#
.SYNOPSIS
    Maps medchain.local to this machine so the app is reachable at
    http://medchain.local instead of http://localhost.

.DESCRIPTION
    Adds two loopback entries to the Windows hosts file. This is the standard
    way to give a local development site a real hostname — nothing is sent to
    the internet and no DNS registration is involved.

    Editing the hosts file requires Administrator rights, which is why this is a
    separate script rather than part of `npm run dev`.

.NOTES
    Run with -Remove to undo. A timestamped backup is written before any change.

.EXAMPLE
    Right-click this file and choose "Run with PowerShell" as Administrator.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\setup-hostname.ps1
    powershell -ExecutionPolicy Bypass -File scripts\setup-hostname.ps1 -Remove
#>
[CmdletBinding()]
param(
    [switch]$Remove
)

$ErrorActionPreference = "Stop"

$hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
$marker = "# MedChain - local development hostname"
$entries = @(
    "127.0.0.1       medchain.local",
    "127.0.0.1       www.medchain.local"
)

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    Write-Host ""
    Write-Host "  This script needs Administrator rights to edit the hosts file." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Do one of these:" -ForegroundColor Yellow
    Write-Host "    1. Right-click PowerShell -> Run as Administrator, then re-run this script"
    Write-Host "    2. Or add these two lines to $hostsPath by hand:"
    Write-Host ""
    foreach ($entry in $entries) { Write-Host "         $entry" -ForegroundColor Cyan }
    Write-Host ""
    exit 1
}

# Always back up before touching a system file.
$backup = "$hostsPath.medchain-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -Path $hostsPath -Destination $backup -Force
Write-Host "Backup written to $backup" -ForegroundColor DarkGray

$lines = Get-Content -Path $hostsPath

if ($Remove) {
    $filtered = $lines | Where-Object { $_ -notmatch "medchain\.local" -and $_ -ne $marker }
    Set-Content -Path $hostsPath -Value $filtered -Encoding ASCII

    Write-Host ""
    Write-Host "  Removed medchain.local from the hosts file." -ForegroundColor Green
    Write-Host "  The app remains available at http://localhost"
    Write-Host ""
}
else {
    if ($lines -match "medchain\.local") {
        Write-Host ""
        Write-Host "  medchain.local is already mapped. Nothing to do." -ForegroundColor Green
    }
    else {
        Add-Content -Path $hostsPath -Value "" -Encoding ASCII
        Add-Content -Path $hostsPath -Value $marker -Encoding ASCII
        foreach ($entry in $entries) {
            Add-Content -Path $hostsPath -Value $entry -Encoding ASCII
        }

        Write-Host ""
        Write-Host "  medchain.local now points at this machine." -ForegroundColor Green
    }

    # Flush the resolver so the change takes effect without a reboot.
    try { ipconfig /flushdns | Out-Null } catch { }

    Write-Host ""
    Write-Host "  Start the app, then open:" -ForegroundColor Cyan
    Write-Host "      http://medchain.local" -ForegroundColor White
    Write-Host ""
    Write-Host "  If the browser shows a search results page instead, type the" -ForegroundColor DarkGray
    Write-Host "  full URL including http:// — some browsers treat a bare" -ForegroundColor DarkGray
    Write-Host "  hostname without a dot-com as a search query." -ForegroundColor DarkGray
    Write-Host ""
}
