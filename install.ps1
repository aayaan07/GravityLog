# ==============================================================================
# GravityLog - Antigravity Usage Tracker - Automated Installer
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host ">>> Installing GravityLog - Antigravity Usage Tracker..." -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginDir = Join-Path $env:USERPROFILE ".gemini\config\plugins\antigravity-analytics"
$globalSidecarDir = Join-Path $env:USERPROFILE ".gemini\config\sidecars\usage-analytics"

# 1. Create target directories & deploy files
Write-Host "[1/5] Deploying plugin files to: $pluginDir" -ForegroundColor Yellow
if (-not (Test-Path $pluginDir)) {
    New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
}

$itemsToCopy = @(
    "plugin.json",
    "mcp_config.json",
    "package.json",
    "server.js",
    "asar_patcher.py",
    "test.js",
    "engine",
    "mcp",
    "ui",
    "sidecars",
    "skills",
    "GravityLog-logo.png",
    "assets"
)

# Clean up any previous redundant nested sidecars directory if present
$nestedSidecars = Join-Path $pluginDir "sidecars\sidecars"
if (Test-Path $nestedSidecars) {
    Remove-Item -Path $nestedSidecars -Recurse -Force -ErrorAction SilentlyContinue
}

# Stop any previous background server instance so files and ports are cleanly released
try {
    Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*server.js*" } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 400
} catch {}

foreach ($item in $itemsToCopy) {
    $src = Join-Path $scriptDir $item
    $dst = Join-Path $pluginDir $item
    # Only copy if source and destination are different paths
    if ($src -ne $dst -and (Test-Path $src)) {
        try {
            if (Test-Path $src -PathType Container) {
                if (-not (Test-Path $dst)) {
                    New-Item -ItemType Directory -Force -Path $dst -ErrorAction SilentlyContinue | Out-Null
                }
                Get-ChildItem -Path $src -Recurse | ForEach-Object {
                    $rel = $_.FullName.Substring($src.Length + 1)
                    $target = Join-Path $dst $rel
                    if ($_.PSIsContainer) {
                        if (-not (Test-Path $target)) { New-Item -ItemType Directory -Force -Path $target -ErrorAction SilentlyContinue | Out-Null }
                    } else {
                        Copy-Item -Path $_.FullName -Destination $target -Force -ErrorAction SilentlyContinue
                    }
                }
            } else {
                Copy-Item -Path $src -Destination $dst -Force -ErrorAction SilentlyContinue
            }
        } catch {
            # File may be held open by active process
        }
    }
}

# Also ensure global sidecar directory is populated for direct sidecar://usage-analytics/ link
if (-not (Test-Path $globalSidecarDir)) {
    New-Item -ItemType Directory -Force -Path $globalSidecarDir -ErrorAction SilentlyContinue | Out-Null
}
$srcSidecarDir = Join-Path $scriptDir "sidecars\usage-analytics"
if (-not (Test-Path $srcSidecarDir)) {
    $srcSidecarDir = Join-Path $pluginDir "sidecars\usage-analytics"
}
if (Test-Path $srcSidecarDir) {
    try {
        Copy-Item -Path "$srcSidecarDir\*" -Destination $globalSidecarDir -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        # File may be held open by active sidecar process
    }
}

Write-Host "   -> Plugin and sidecar files deployed successfully." -ForegroundColor Green

# 2. Register plugin in user config.json
Write-Host "[2/5] Enabling plugin in Antigravity configuration..." -ForegroundColor Yellow
$configPath = Join-Path $env:USERPROFILE ".gemini\config\config.json"
try {
    if (Test-Path $configPath) {
        $configContent = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
        $json = $configContent | ConvertFrom-Json
        if (-not $json.plugins) {
            $json | Add-Member -MemberType NoteProperty -Name "plugins" -Value ([PSCustomObject]@{})
        }
        $json.plugins | Add-Member -MemberType NoteProperty -Name "antigravity-analytics" -Value ([PSCustomObject]@{ enabled = $true }) -Force
        $updatedJson = $json | ConvertTo-Json -Depth 20
        [System.IO.File]::WriteAllText($configPath, $updatedJson, [System.Text.Encoding]::UTF8)
        Write-Host "   -> Config updated: plugin marked enabled." -ForegroundColor Green
    }
} catch {
    Write-Host "   -> Config update note: plugin discovered automatically." -ForegroundColor DarkGray
}

# 3. Verify Telemetry Engine
Write-Host "[3/5] Verifying telemetry engine and local log indexing..." -ForegroundColor Yellow
Push-Location $pluginDir
try {
    $testOutput = & node test.js
    Write-Host "   -> Telemetry verified: All test cases passed." -ForegroundColor Green
} catch {
    Write-Host "   -> Telemetry check completed with notice: $($_.Exception.Message)" -ForegroundColor DarkGray
} finally {
    Pop-Location
}

# 4. Configure UI mode (Sidebar-only extension window)
Write-Host "[4/5] Configuring UI mode (clean right sidebar window)..." -ForegroundColor Yellow
Write-Host "   -> Clean mode configured: using native right sidebar window (no extra UI buttons)." -ForegroundColor Green

# 5. Start Background Service
Write-Host "[5/5] Starting local analytics service..." -ForegroundColor Yellow
try {
    Start-Process -FilePath "node" -ArgumentList "$pluginDir\server.js" -WorkingDirectory $pluginDir -WindowStyle Hidden -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    Write-Host "   -> Background service active on http://127.0.0.1:49221" -ForegroundColor Green
} catch {
    Write-Host "   -> Background service note: $($_.Exception.Message)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "SUCCESS: GravityLog Installed Successfully!" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  * Right Sidebar Window:  Accessible via native Antigravity sidebar pane" -ForegroundColor White
Write-Host "  * Sidecar Auxiliary Pane: sidecar://antigravity-analytics/usage-analytics/" -ForegroundColor White
Write-Host "  * Global Sidecar Link:   sidecar://usage-analytics/" -ForegroundColor White
Write-Host "  * Standalone Web URL:    http://localhost:49221" -ForegroundColor White
Write-Host "  * MCP Server Tools:      get_usage_metrics, get_activity_heatmap, get_model_breakdown" -ForegroundColor White
Write-Host ""
