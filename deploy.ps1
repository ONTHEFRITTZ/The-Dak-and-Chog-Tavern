Param(
    [Parameter(Mandatory=$true)][Alias('Host')][string]$HostName,
    [Parameter(Mandatory=$true)][string]$User,
    [string]$Domain = "thedakandchog.xyz",
    [string]$RemoteRoot = "/var/www",
    [int]$Port = 22,
    [string]$IdentityFile
)

$ErrorActionPreference = 'Stop'
$PSDefaultParameterValues['*:ErrorAction'] = 'Stop'

if ($HostName -eq 'your.server' -or [string]::IsNullOrWhiteSpace($HostName)) {
    throw "-Host must be your actual server hostname or IP (not 'your.server')."
}

function Require-Cmd($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Required executable not found: $name"
    }
}

Require-Cmd ssh
Require-Cmd scp

# Build common SSH/SCP args and target
$sshTarget = "$User@$HostName"
$sshArgsBase = @()
if ($IdentityFile -and $IdentityFile.Trim() -ne "") { $sshArgsBase += @('-i', $IdentityFile) }
$sshArgsBase += @('-p', $Port)

$scpArgsBase = @()
if ($IdentityFile -and $IdentityFile.Trim() -ne "") { $scpArgsBase += @('-i', $IdentityFile) }
$scpArgsBase += @('-P', $Port)

$RemoteBase = "$RemoteRoot/$Domain"
$RemotePath = "$RemoteBase/html"
$UploadPath = "$RemoteBase/html_upload"

Write-Host "Preparing remote directories ($RemotePath and temp $UploadPath)..."
& ssh @sshArgsBase $sshTarget "sudo mkdir -p '$UploadPath' '$RemotePath'; sudo chown -R ${User}:${User} '$RemoteBase'; sudo rm -rf '$UploadPath'/*"
if ($LASTEXITCODE -ne 0) { throw "SSH failed creating remote directories (host: $HostName)" }

# Generate build metadata (commit + timestamp) for footer
try {
    $commit = (git rev-parse --short HEAD) 2>$null
} catch { $commit = $null }
if (-not $commit) { $commit = "local" }
$builtAt = (Get-Date).ToUniversalTime().ToString("s") + "Z"
$buildJson = "{`"commit`":`"$commit`",`"builtAt`":`"$builtAt`"}"
try { Set-Content -LiteralPath "assets\build.json" -Value $buildJson -Encoding ASCII } catch {}

Write-Host "Uploading HTML files..."
$htmlFiles = Get-ChildItem -File -Filter *.html -ErrorAction SilentlyContinue
foreach ($f in $htmlFiles) {
    & scp @scpArgsBase "$($f.FullName)" "$($sshTarget):$UploadPath/"
    if ($LASTEXITCODE -ne 0) { throw "SCP failed uploading HTML file: $($f.Name)" }
}

Write-Host "Uploading top-level assets (icons/images) if present..."
$assetFiles = Get-ChildItem -File -Include *.ico,*.png,*.jpg,*.jpeg,*.webp,*.svg -ErrorAction SilentlyContinue
foreach ($a in $assetFiles) {
    & scp @scpArgsBase "$($a.FullName)" "$($sshTarget):$UploadPath/"
    if ($LASTEXITCODE -ne 0) { throw "SCP failed uploading asset: $($a.Name)" }
}

$dirs = @("css","js","img","images","assets","fonts","media","admin","games")
foreach ($d in $dirs) {
    if (Test-Path -Path $d) {
        Write-Host "Uploading directory $d..."
        & scp @scpArgsBase -r "$d" "$($sshTarget):$UploadPath/"
        if ($LASTEXITCODE -ne 0) { throw "SCP failed uploading directory: $d" }
    }
}

Write-Host "Swapping uploaded content into place..."
& ssh @sshArgsBase $sshTarget "set -e; ts=`$(date +%s); if [ -d '$RemotePath' ]; then sudo mv '$RemotePath' '${RemoteBase}/html_prev_'`$ts; fi; sudo mv '$UploadPath' '$RemotePath'"
if ($LASTEXITCODE -ne 0) { throw "SSH failed during atomic swap on remote host" }

Write-Host ("Deployment complete to {0}@{1}:{2}" -f $User, $HostName, $RemotePath)

# Fix permissions and verify key files exist
Write-Host "Fixing permissions and verifying files..."
$verifyCmd = @(
  "set -e",
  "sudo find '$RemotePath' -type d -exec chmod 755 {} +",
  "sudo find '$RemotePath' -type f -exec chmod 644 {} +",
  "if [ -f '$RemotePath/admin/index.html' ] && [ -f '$RemotePath/assets/images/tavern-bg.png' ]; then echo 'VERIFY_OK'; else echo 'VERIFY_FAIL'; fi"
) -join '; '
& ssh @sshArgsBase $sshTarget $verifyCmd
if ($LASTEXITCODE -ne 0) { throw "SSH verification failed on remote host" }

# Cleanup local build metadata file (optional)
try { Remove-Item -LiteralPath "assets\build.json" -Force -ErrorAction SilentlyContinue } catch {}
