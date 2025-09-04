# Sets up 'stable' and 'experimental' branches.
# Usage: .\scripts\setup-branches.ps1 [-Push]

[CmdletBinding()]
param(
  [switch]$Push
)

$ErrorActionPreference = 'Stop'

function Exec($cmd, [switch]$Quiet) {
  if ($Quiet) {
    & git $cmd 2>$null 1>$null
  } else {
    & git $cmd
  }
  return $LASTEXITCODE
}

function BranchExists($name) {
  & git rev-parse --verify --quiet $name 2>$null 1>$null
  return ($LASTEXITCODE -eq 0)
}

if (-not (Test-Path -LiteralPath '.git')) {
  Write-Error "Not inside a Git repository (missing .git)."
}

# Determine base branch: main -> master -> current
$base = $null
if (BranchExists 'main') { $base = 'main' }
elseif (BranchExists 'master') { $base = 'master' }
else {
  $current = & git symbolic-ref --short HEAD 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($current)) {
    Write-Error 'Could not determine a base branch (no main/master and unable to detect current).'
  }
  $base = $current.Trim()
}

Write-Host "Using base branch: $base"

# Create stable if missing
if (BranchExists 'stable') {
  Write-Host "Branch 'stable' already exists."
} else {
  Write-Host "Creating 'stable' from '$base'..."
  & git branch stable $base | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Error "Failed to create 'stable' from '$base'" }
}

# Create experimental if missing
if (BranchExists 'experimental') {
  Write-Host "Branch 'experimental' already exists."
} else {
  Write-Host "Creating 'experimental' from 'stable'..."
  & git branch experimental stable | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Error "Failed to create 'experimental' from 'stable'" }
}

if ($Push) {
  # Ensure remote exists
  & git remote get-url origin 1>$null 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host 'Pushing branches to origin...'
    & git push -u origin stable
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not push 'stable' (is authentication set up?)" }
    & git push -u origin experimental
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not push 'experimental' (is authentication set up?)" }
  } else {
    Write-Warning "No 'origin' remote configured; skipping push."
  }
}

Write-Host 'Done. Suggested next steps:'
Write-Host ' - Switch to experimental:   git checkout experimental'
Write-Host ' - Protect stable branch on your remote (in repo settings)'
Write-Host ' - Tag releases from stable: git tag v1.0.0 && git push origin v1.0.0'

