Param(
  [Parameter(Mandatory=$true)][Alias('Host','Hostname')][string]$Server,
  [Parameter(Mandatory=$true)][string]$User,
  [string]$IdentityFile,
  [int]$Port = 22,
  [string[]]$Paths = @('/var/www/thedakandchog.xyz/html','/var/www/html')
)

$ErrorActionPreference = 'Stop'
function Require-Cmd($name){ if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "Required executable not found: $name" } }
Require-Cmd ssh; Require-Cmd scp

$sshTarget = "$User@$Server"
$sshArgs = @(); if ($IdentityFile) { $sshArgs += @('-i', $IdentityFile) } $sshArgs += @('-p', $Port)
$scpArgs = @(); if ($IdentityFile) { $scpArgs += @('-i', $IdentityFile) } $scpArgs += @('-P', $Port)

Write-Host "Generating build metadata..."
try {
  $commit = (git rev-parse --short HEAD) 2>$null
} catch { $commit = $null }
if (-not $commit) { $commit = "local" }
$builtAt = (Get-Date).ToUniversalTime().ToString("s") + "Z"
$buildJson = "{`"commit`":`"$commit`",`"builtAt`":`"$builtAt`"}"
New-Item -ItemType Directory -Force assets | Out-Null
Set-Content -LiteralPath "assets\build.json" -Value $buildJson -Encoding ASCII

# Build upload list
$roots = @()
$roots += Get-ChildItem -File -Filter *.html -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
foreach ($d in @('css','js','assets','admin','games','images','img','fonts','media')) { if (Test-Path $d) { $roots += $d } }
if (-not $roots -or $roots.Count -eq 0) { throw "Nothing to upload (no HTML or asset directories found)." }

foreach ($targetPath in $Paths) {
  if (-not $targetPath -or $targetPath.Trim() -eq '') { continue }
  Write-Host "\n=== Deploying to $targetPath ==="
  $tmp = "/tmp/tavern_upload_$([System.Guid]::NewGuid().ToString('N'))"
  Write-Host "Preparing remote temp $tmp..."
  & ssh @sshArgs $sshTarget "mkdir -p '$tmp'" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "SSH failed creating $tmp" }

  Write-Host "Uploading files..."
  foreach ($item in $roots) {
    if (Test-Path $item -PathType Leaf) {
      & scp @scpArgs "$item" "${sshTarget}:$tmp/" | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "SCP failed uploading file: $item" }
    } elseif (Test-Path $item -PathType Container) {
      & scp @scpArgs -r "$item" "${sshTarget}:$tmp/" | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "SCP failed uploading directory: $item" }
    }
  }

  Write-Host "Atomic swap into $targetPath ..."
  $script = @'
set -e
ts=$(date +%s)
base="__BASE__"
prev="${base}_prev_${ts}"
sudo mkdir -p "$base"
if [ -d "$base" ]; then sudo mv "$base" "$prev"; fi
sudo mv '__TMP__' "$base"
sudo find "$base" -type d -exec chmod 755 {} +
sudo find "$base" -type f -exec chmod 644 {} +
sudo mkdir -p "$base/assets"
echo "__COMMIT__ @ __BUILT__" | sudo tee "$base/assets/deploy_check.txt" >/dev/null
ls -la "$base" | sed -n '1,60p'
ls -la "$base/assets" | sed -n '1,60p' || true
'@
  $script = $script.Replace('__BASE__', $targetPath).Replace('__TMP__', $tmp).Replace('__COMMIT__', $commit).Replace('__BUILT__', $builtAt)
  $script | & ssh @sshArgs $sshTarget bash -s
  if ($LASTEXITCODE -ne 0) { throw "SSH swap failed for $targetPath" }
}

Write-Host "\nDone. Verify: /assets/build.json and /assets/deploy_check.txt on your domain."
