<#
.SYNOPSIS
    Starts MedChain as a background site that outlives the terminal that
    launched it, and optionally brings it back at every Windows logon.

.DESCRIPTION
    Brings up the whole stack in dependency order:

        1. MongoDB          .local/mongodb/data  -> 127.0.0.1:27017
        2. Hardhat node     in-memory chain      -> 127.0.0.1:8545
        3. Contract         redeployed only when the chain has lost it
        4. Frontend build   only when frontend/dist is missing
        5. App              backend/src/site.js  -> http://localhost:3000

    Every process is launched with Start-Process, so none of them is a child
    of the shell, the VS Code terminal, or an agent session. Closing any of
    those leaves the site running.

    Step 3 is what makes a reboot safe. Hardhat keeps its chain in memory, so
    a restart wipes every anchor and orphans the ids stored in MongoDB. The
    script asks the chain whether CONTRACT_ADDRESS still holds code; if it
    does not, it redeploys, writes the new address into backend/.env, and
    re-anchors every live record. When the chain is intact it skips all of
    that and starts in a couple of seconds.

    Safe to re-run. Anything already listening is left alone.

.NOTES
    No Administrator rights are required. -Install prefers a Scheduled Task
    and falls back to a Startup-folder entry when the task store refuses an
    unelevated write; both run as you, at logon, with no visible window.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\start-medchain.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\start-medchain.ps1 -Install
    powershell -ExecutionPolicy Bypass -File scripts\start-medchain.ps1 -Stop
    powershell -ExecutionPolicy Bypass -File scripts\start-medchain.ps1 -Status
#>
[CmdletBinding()]
param(
    [int]$Port = 3000,
    [switch]$Build,
    [switch]$Stop,
    [switch]$Status,
    [switch]$Install,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root ".local\logs"
$statePath = Join-Path $logDir "medchain.pids.json"
$envPath = Join-Path $root "backend\.env"
$taskName = "MedChain"

$startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$startupPath = Join-Path $startupDir "MedChain.vbs"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

# ---------------------------------------------------------------- helpers ---

function Test-Port {
    param([int]$Number)

    $client = New-Object Net.Sockets.TcpClient
    try {
        $client.Connect("127.0.0.1", $Number)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-Port {
    param(
        [int]$Number,
        [string]$Label,
        [int]$TimeoutSeconds = 90
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Port -Number $Number) { return $true }
        Start-Sleep -Milliseconds 500
    }

    throw "$Label did not come up on port $Number within $TimeoutSeconds seconds. See $logDir."
}

# Start-Process detaches the child from this shell's lifetime, which is the
# whole point of the script. Separate stdout/stderr files because Windows
# refuses to redirect both streams to one path.
function Start-Detached {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [string]$LogName
    )

    $process = Start-Process -FilePath $FilePath `
        -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir "$LogName.log") `
        -RedirectStandardError (Join-Path $logDir "$LogName.err.log") `
        -PassThru

    return $process
}

function Save-State {
    param([hashtable]$Pids)

    $Pids | ConvertTo-Json | Set-Content -Path $statePath -Encoding utf8
}

function Get-State {
    if (-not (Test-Path $statePath)) { return $null }
    try { return Get-Content -Path $statePath -Raw | ConvertFrom-Json }
    catch { return $null }
}

function Get-HardhatBin {
    $bin = Join-Path $root "blockchain\node_modules\hardhat\internal\cli\bootstrap.js"
    if (-not (Test-Path $bin)) {
        throw "Hardhat is not installed. Run: npm --prefix blockchain install"
    }
    return $bin
}

# "0x" means the address holds no code - the chain restarted and the anchors
# in MongoDB now point at a contract that does not exist.
function Test-ContractLive {
    param([string]$Address)

    if (-not $Address) { return $false }

    $body = '{"jsonrpc":"2.0","method":"eth_getCode","params":["' + $Address + '","latest"],"id":1}'
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:8545" -Method Post `
            -ContentType "application/json" -Body $body -TimeoutSec 10
        return ($response.result -and $response.result -ne "0x")
    }
    catch {
        return $false
    }
}

function Get-EnvValue {
    param([string]$Key)

    if (-not (Test-Path $envPath)) { return $null }
    $line = Select-String -Path $envPath -Pattern "^$Key=(.*)$" | Select-Object -First 1
    if (-not $line) { return $null }
    return $line.Matches[0].Groups[1].Value.Trim()
}

function Set-EnvValue {
    param(
        [string]$Key,
        [string]$Value
    )

    # Read and write through .NET rather than Get-Content/Set-Content. Windows
    # PowerShell defaults to the ANSI code page for both, which corrupts every
    # non-ASCII character in the comments, and its "utf8" writes a BOM that
    # dotenv would fold into the first key's name.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $content = [System.IO.File]::ReadAllText($envPath, [System.Text.Encoding]::UTF8)
    $content = [regex]::Replace($content, "(?m)^$Key=.*$", "$Key=$Value")
    [System.IO.File]::WriteAllText($envPath, $content, $utf8NoBom)
}

function Write-Step {
    param([string]$Message)
    Write-Host "  $Message" -ForegroundColor DarkGray
}

# ------------------------------------------------------------ autostart -----

function Install-Autostart {
    $command = "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Port $Port"

    try {
        $action = New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Port $Port"
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
        # A laptop on battery must still serve the site, and the stack has no
        # fixed runtime, so the default execution limit has to go.
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -StartWhenAvailable

        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
            -Settings $settings -Description "Starts the MedChain site at logon." `
            -Force -ErrorAction Stop | Out-Null

        Write-Host ""
        Write-Host "  Registered scheduled task '$taskName' - starts at every logon." -ForegroundColor Green
        Write-Host "  Remove it with: -Uninstall" -ForegroundColor DarkGray
        Write-Host ""
        return
    }
    catch {
        $reason = $_.Exception.Message.Trim()
        Write-Step "Scheduled task refused ($reason). Falling back to the Startup folder."
    }

    # Fallback: a WScript launcher, which runs the same command with no console
    # window at all. Pure per-user, never needs elevation.
    #
    # Built by concatenation rather than a here-string: the line below needs
    # literal double quotes doubled for VBScript, and nesting that inside an
    # expandable string is more than the Windows PowerShell parser will take.
    $quoted = $command.Replace('"', '""')
    $vbs = @(
        "' MedChain - starts the local site at logon. Delete this file to disable.",
        ('CreateObject("WScript.Shell").Run "' + $quoted + '", 0, False')
    )
    Set-Content -Path $startupPath -Value $vbs -Encoding ascii

    Write-Host ""
    Write-Host "  Added a Startup entry - starts at every logon." -ForegroundColor Green
    Write-Host "  $startupPath" -ForegroundColor DarkGray
    Write-Host ""
}

function Uninstall-Autostart {
    $removed = $false

    try {
        if (Get-ScheduledTask -TaskName $taskName -ErrorAction Stop) {
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
            Write-Host "  Removed scheduled task '$taskName'." -ForegroundColor Green
            $removed = $true
        }
    }
    catch { }

    if (Test-Path $startupPath) {
        Remove-Item -Path $startupPath -Force
        Write-Host "  Removed the Startup entry." -ForegroundColor Green
        $removed = $true
    }

    if (-not $removed) { Write-Host "  No autostart entry was installed." -ForegroundColor Yellow }
}

# -------------------------------------------------------------- commands ---

function Show-Status {
    $checks = @(
        @{ Label = "MongoDB "; Port = 27017 },
        @{ Label = "Hardhat "; Port = 8545 },
        @{ Label = "Site    "; Port = $Port }
    )

    Write-Host ""
    foreach ($check in $checks) {
        if (Test-Port -Number $check.Port) {
            Write-Host "  $($check.Label) port $($check.Port)  running" -ForegroundColor Green
        }
        else {
            Write-Host "  $($check.Label) port $($check.Port)  stopped" -ForegroundColor Yellow
        }
    }

    $autostart = "not installed"
    try { if (Get-ScheduledTask -TaskName $taskName -ErrorAction Stop) { $autostart = "scheduled task" } } catch { }
    if (Test-Path $startupPath) { $autostart = "startup folder" }

    Write-Host ""
    Write-Host "  Autostart: $autostart" -ForegroundColor DarkGray
    Write-Host ""
}

function Stop-Stack {
    $state = Get-State
    $stopped = 0

    if ($state) {
        foreach ($name in @("app", "chain", "mongo")) {
            $processId = $state.$name
            if (-not $processId) { continue }

            try {
                $process = Get-Process -Id $processId -ErrorAction Stop
                $process.CloseMainWindow() | Out-Null
                Stop-Process -Id $processId -Force -ErrorAction Stop
                Write-Step "Stopped $name (pid $processId)"
                $stopped++
            }
            catch { }
        }
    }

    if ($stopped -eq 0) {
        Write-Host "  Nothing recorded as running." -ForegroundColor Yellow
        Write-Host "  If a port is still held, find it with: Get-NetTCPConnection -LocalPort $Port" -ForegroundColor DarkGray
        return
    }

    Remove-Item -Path $statePath -Force -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "  MedChain stopped." -ForegroundColor Green
    Write-Host ""
}

function Start-Stack {
    Write-Host ""
    Write-Host "  Starting MedChain..." -ForegroundColor Cyan
    Write-Host ""

    $state = Get-State
    $pids = @{}
    if ($state) {
        foreach ($name in @("app", "chain", "mongo")) {
            if ($state.$name) { $pids[$name] = $state.$name }
        }
    }

    # 1. MongoDB -------------------------------------------------------------
    if (Test-Port -Number 27017) {
        Write-Step "MongoDB already listening on 27017"
    }
    else {
        $mongod = Get-ChildItem -Path (Join-Path $root ".local\mongodb") -Filter "mongod.exe" `
            -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1

        if (-not $mongod) {
            throw "mongod.exe not found under .local\mongodb. See the Quick start in README.md."
        }

        $dataPath = Join-Path $root ".local\mongodb\data"
        if (-not (Test-Path $dataPath)) { New-Item -ItemType Directory -Path $dataPath -Force | Out-Null }

        # mongod writes its own log via --logpath, but its stdout handle is
        # still inherited from this shell. Left attached, a caller that pipes
        # this script (npm run site | ...) never sees the pipe close and hangs
        # long after the site is up. Redirect it to a file to cut the handle.
        $process = Start-Process -FilePath $mongod.FullName `
            -ArgumentList @("--dbpath", "`"$dataPath`"", "--port", "27017",
                            "--logpath", "`"$(Join-Path $root ".local\mongodb\mongod.log")`"", "--logappend") `
            -WorkingDirectory $root -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $logDir "mongod.log") `
            -RedirectStandardError (Join-Path $logDir "mongod.err.log")

        $pids["mongo"] = $process.Id
        Wait-Port -Number 27017 -Label "MongoDB" | Out-Null
        Write-Step "MongoDB started on 27017 (pid $($process.Id))"
    }

    # 2. Hardhat -------------------------------------------------------------
    if (Test-Port -Number 8545) {
        Write-Step "Hardhat already listening on 8545"
    }
    else {
        $process = Start-Detached -FilePath "node" `
            -Arguments @("`"$(Get-HardhatBin)`"", "node") `
            -WorkingDirectory (Join-Path $root "blockchain") `
            -LogName "hardhat"

        $pids["chain"] = $process.Id
        Wait-Port -Number 8545 -Label "Hardhat" | Out-Null
        Write-Step "Hardhat started on 8545 (pid $($process.Id))"
    }

    # 3. Contract ------------------------------------------------------------
    # Checked on every run, not only after a restart: the chain may have been
    # restarted by something other than this script.
    $address = Get-EnvValue -Key "CONTRACT_ADDRESS"

    if (Test-ContractLive -Address $address) {
        Write-Step "Contract live at $address"
    }
    else {
        Write-Step "Contract missing from the chain - redeploying"

        Push-Location (Join-Path $root "blockchain")
        try {
            $output = & node (Get-HardhatBin) run scripts/deploy.js --network localhost 2>&1 |
                ForEach-Object { $_.ToString() }
        }
        finally {
            Pop-Location
        }

        $match = $output | Select-String -Pattern "Deployed to\s*:\s*(0x[0-9a-fA-F]{40})" | Select-Object -First 1
        if (-not $match) {
            $output | Set-Content -Path (Join-Path $logDir "deploy.err.log") -Encoding utf8
            throw "Contract deployment failed. See $logDir\deploy.err.log"
        }

        $address = $match.Matches[0].Groups[1].Value
        Set-EnvValue -Key "CONTRACT_ADDRESS" -Value $address
        Write-Step "Deployed to $address and wrote it to backend/.env"

        # The chain is empty, but MongoDB still marks records "confirmed"
        # against the previous deployment. --reset clears those stale anchors
        # so the backfill re-creates them against the contract that now exists.
        Write-Step "Re-anchoring records (this can take a minute)"

        Push-Location (Join-Path $root "backend")
        try {
            $backfill = & node src/scripts/backfillAnchors.js --reset 2>&1 |
                ForEach-Object { $_.ToString() }
        }
        finally {
            Pop-Location
        }

        $backfill | Set-Content -Path (Join-Path $logDir "backfill.log") -Encoding utf8

        $summary = $backfill | Select-String -Pattern "^(Done\.|Nothing to backfill)" | Select-Object -Last 1
        if ($summary) { Write-Step $summary.Line.Trim() }
    }

    # 4. Frontend build ------------------------------------------------------
    $indexPath = Join-Path $root "frontend\dist\index.html"

    if ($Build -or -not (Test-Path $indexPath)) {
        Write-Step "Building the frontend"

        Push-Location (Join-Path $root "frontend")
        try {
            $buildOutput = & npm.cmd run build 2>&1 | ForEach-Object { $_.ToString() }
        }
        finally {
            Pop-Location
        }

        $buildOutput | Set-Content -Path (Join-Path $logDir "build.log") -Encoding utf8

        if (-not (Test-Path $indexPath)) {
            throw "Frontend build produced no dist/index.html. See $logDir\build.log"
        }
        Write-Step "Frontend built"
    }
    else {
        Write-Step "Frontend build present (rebuild with -Build)"
    }

    # 5. App -----------------------------------------------------------------
    if (Test-Port -Number $Port) {
        Write-Step "Something is already listening on $Port - leaving it alone"
    }
    else {
        # site.js assigns with ??=, so anything set here wins over backend/.env.
        # Set on this shell only long enough for the child to inherit it.
        $previousPort = $env:PORT
        $previousServe = $env:SERVE_FRONTEND
        $env:PORT = "$Port"
        $env:SERVE_FRONTEND = "true"

        try {
            $process = Start-Detached -FilePath "node" `
                -Arguments @("src/site.js") `
                -WorkingDirectory (Join-Path $root "backend") `
                -LogName "app"
        }
        finally {
            $env:PORT = $previousPort
            $env:SERVE_FRONTEND = $previousServe
        }

        $pids["app"] = $process.Id
        Wait-Port -Number $Port -Label "MedChain" | Out-Null
        Write-Step "App started on $Port (pid $($process.Id))"
    }

    Save-State -Pids $pids

    # Confirm the app is actually serving, not merely holding the socket.
    $health = $null
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 20
    }
    catch { }

    Write-Host ""
    if ($health -and $health.status -eq "success") {
        Write-Host "  MedChain is running at http://localhost:$Port" -ForegroundColor Green
        Write-Host ""
        Write-Host "    database    $($health.data.database)" -ForegroundColor DarkGray
        Write-Host "    blockchain  connected=$($health.data.blockchain.connected) records=$($health.data.blockchain.recordCount)" -ForegroundColor DarkGray
        Write-Host "    contract    $($health.data.blockchain.contractAddress)" -ForegroundColor DarkGray
    }
    else {
        Write-Host "  Port $Port is open but /api/v1/health did not answer." -ForegroundColor Yellow
        Write-Host "  Check $logDir\app.err.log" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "  This survives closing VS Code. Stop it with -Stop." -ForegroundColor DarkGray
    Write-Host ""
}

# ------------------------------------------------------------------ main ---

if ($Uninstall) { Uninstall-Autostart; return }
if ($Status) { Show-Status; return }
if ($Stop) { Stop-Stack; return }

Start-Stack

if ($Install) { Install-Autostart }
