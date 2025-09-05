Param(
    [Parameter(Mandatory=$true)][string]$Host,
    [Parameter(Mandatory=$true)][string]$User,
    [string]$Domain = "thedakandchog.xyz",
    [string]$RemoteRoot = "/var/www",
    [int]$Port = 22,
    [string]$IdentityFile
)

$ErrorActionPreference = 'Stop'

function Require-Cmd($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "Required executable not found: $name"
    }
}

Require-Cmd ssh
Require-Cmd scp

# Build optional identity flag
$IdFlag = ""
if ($IdentityFile -and $IdentityFile.Trim() -ne "") {
    $IdFlag = "-i `"$IdentityFile`""
}

$RemoteBase = "$RemoteRoot/$Domain"
$RemotePath = "$RemoteBase/html"
$UploadPath = "$RemoteBase/html_upload"

Write-Host "Preparing remote directories ($RemotePath and temp $UploadPath)..."
& powershell -NoProfile -Command "ssh $IdFlag -p $Port $User@$Host `"mkdir -p $UploadPath && mkdir -p $RemotePath && chown -R \$USER:\$USER $RemoteBase && rm -rf $UploadPath/*`""

Write-Host "Uploading HTML files..."
$htmlFiles = Get-ChildItem -File -Filter *.html -ErrorAction SilentlyContinue
foreach ($f in $htmlFiles) {
    & powershell -NoProfile -Command "scp $IdFlag -P $Port `"$($f.FullName)`" `"$User@$Host:$UploadPath/`""
}

Write-Host "Uploading top-level assets (icons/images) if present..."
$assetFiles = Get-ChildItem -File -Include *.ico,*.png,*.jpg,*.jpeg,*.webp,*.svg -ErrorAction SilentlyContinue
foreach ($a in $assetFiles) {
    & powershell -NoProfile -Command "scp $IdFlag -P $Port `"$($a.FullName)`" `"$User@$Host:$UploadPath/`""
}

$dirs = @("css","js","img","images","assets","fonts","media")
foreach ($d in $dirs) {
    if (Test-Path -Path $d) {
        Write-Host "Uploading directory $d..."
        & powershell -NoProfile -Command "scp -r $IdFlag -P $Port `"$d`" `"$User@$Host:$UploadPath/`""
    }
}

Write-Host "Swapping uploaded content into place..."
& powershell -NoProfile -Command "ssh $IdFlag -p $Port $User@$Host `"set -e; ts=\$(date +%s); if [ -d $RemotePath ]; then mv $RemotePath ${RemoteBase}/html_prev_\$ts; fi; mv $UploadPath $RemotePath`""

Write-Host "Deployment complete to $User@$Host:$RemotePath"

Write-Host "Deployment complete to $User@$Host:$RemotePath"
