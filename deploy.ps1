Param(
    [Parameter(Mandatory=$true)][Alias('Host')][string]$HostName,
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

Write-Host "Uploading HTML files..."
$htmlFiles = Get-ChildItem -File -Filter *.html -ErrorAction SilentlyContinue
foreach ($f in $htmlFiles) {
    & scp @scpArgsBase "$($f.FullName)" "$($sshTarget):$UploadPath/"
}

Write-Host "Uploading top-level assets (icons/images) if present..."
$assetFiles = Get-ChildItem -File -Include *.ico,*.png,*.jpg,*.jpeg,*.webp,*.svg -ErrorAction SilentlyContinue
foreach ($a in $assetFiles) {
    & scp @scpArgsBase "$($a.FullName)" "$($sshTarget):$UploadPath/"
}

$dirs = @("css","js","img","images","assets","fonts","media","admin","games")
foreach ($d in $dirs) {
    if (Test-Path -Path $d) {
        Write-Host "Uploading directory $d..."
        & scp @scpArgsBase -r "$d" "$($sshTarget):$UploadPath/"
    }
}

Write-Host "Swapping uploaded content into place..."
& ssh @sshArgsBase $sshTarget "set -e; ts=`$(date +%s); if [ -d '$RemotePath' ]; then sudo mv '$RemotePath' '${RemoteBase}/html_prev_'`$ts; fi; sudo mv '$UploadPath' '$RemotePath'"

Write-Host ("Deployment complete to {0}@{1}:{2}" -f $User, $HostName, $RemotePath)
