# ==============================================================================
# GravityLog - Antigravity Usage Tracker - Uninstaller
# ==============================================================================

$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host ">>> Uninstalling GravityLog - Antigravity Usage Tracker..." -ForegroundColor Cyan
Write-Host ""

$pluginDir = Join-Path $env:USERPROFILE ".gemini\config\plugins\antigravity-analytics"
$globalSidecarDir = Join-Path $env:USERPROFILE ".gemini\config\sidecars\usage-analytics"

# 1. Restore Electron app.asar if patched
Write-Host "[1/4] Restoring original app.asar..." -ForegroundColor Yellow
if (Test-Path "$pluginDir\asar_patcher.py") {
    & python "$pluginDir\asar_patcher.py" restore
}

# 2. Stop running service
Write-Host "[2/4] Stopping background analytics service..." -ForegroundColor Yellow
$svcProcess = Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*antigravity-analytics\server.js*" -or $_.CommandLine -like "*GitGravity\server.js*" }
if ($svcProcess) {
    Stop-Process -Id $svcProcess.Id -Force
    Write-Host "   -> Stopped background process." -ForegroundColor Green
}

# 3. Disable in config.json
Write-Host "[3/4] Updating config.json..." -ForegroundColor Yellow
$configPath = Join-Path $env:USERPROFILE ".gemini\config\config.json"
try {
    if (Test-Path $configPath) {
        $configContent = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
        $json = $configContent | ConvertFrom-Json
        if ($json.plugins -and $json.plugins."antigravity-analytics") {
            $json.plugins."antigravity-analytics".enabled = $false
            $updatedJson = $json | ConvertTo-Json -Depth 20
            [System.IO.File]::WriteAllText($configPath, $updatedJson, [System.Text.Encoding]::UTF8)
            Write-Host "   -> Plugin marked disabled in config.json." -ForegroundColor Green
        }
    }
} catch {}

# 4. Remove global sidecar link
Write-Host "[4/4] Cleaning sidecar registrations..." -ForegroundColor Yellow
if (Test-Path $globalSidecarDir) {
    Remove-Item -Path $globalSidecarDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "SUCCESS: GravityLog uninstalled cleanly." -ForegroundColor Green
Write-Host ""
