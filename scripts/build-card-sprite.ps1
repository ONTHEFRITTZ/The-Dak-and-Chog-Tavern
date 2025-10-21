param(
  [string]$SourceDir = 'assets/images/chog_cards',
  [string]$OutDir = 'assets/images/cards',
  [string]$OutFile = 'cards-sprite.png'
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $SourceDir)) {
  throw "SourceDir not found: $SourceDir"
}

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$rankNames = @('ace','two','three','four','five','six','seven','eight','nine','ten','jack','queen','king')
$rankCodes = @('A','2','3','4','5','6','7','8','9','T','J','Q','K')
$suitNames = @('spades','hearts','diamonds','clubs')
$suitCodes = @('S','H','D','C')

# Build map: rank+suit code -> source image path
$files = Get-ChildItem -Recurse -File $SourceDir | Where-Object { $_.Name -like 'chog-*-of-*.png' }
$map = @{}
foreach ($file in $files) {
  if ($file.Name -match 'chog-([a-z]+)-of-([a-z]+)\.png') {
    $rankName = $Matches[1]
    $suitName = $Matches[2]

    $rankIndex = [array]::IndexOf($rankNames, $rankName)
    $suitIndex = [array]::IndexOf($suitNames, $suitName)

    if ($rankIndex -ge 0 -and $suitIndex -ge 0) {
      $code = $rankCodes[$rankIndex] + $suitCodes[$suitIndex]
      $map[$code] = $file.FullName
    }
  }
}

# Validate that every rank/suit combination exists
$missing = @()
for ($suitIndex = 0; $suitIndex -lt $suitCodes.Count; $suitIndex++) {
  for ($rankIndex = 0; $rankIndex -lt $rankCodes.Count; $rankIndex++) {
    $code = $rankCodes[$rankIndex] + $suitCodes[$suitIndex]
    if (-not $map.ContainsKey($code)) {
      $missing += $code
    }
  }
}

if ($missing.Count -gt 0) {
  Write-Host "[WARN] Missing cards: $($missing -join ', ')"
}

# Determine card dimensions from the first available asset
$firstPath = $map.Values | Select-Object -First 1
if (-not $firstPath) {
  throw 'No card images found'
}

$firstBitmap = New-Object System.Drawing.Bitmap($firstPath)
$tileWidth = $firstBitmap.Width
$tileHeight = $firstBitmap.Height
$firstBitmap.Dispose()

$cardColumns = $rankCodes.Count
$cols = $cardColumns + 1 # include card back column
$rows = $suitCodes.Count
$sheetWidth = $cols * $tileWidth
$sheetHeight = $rows * $tileHeight

$sheet = New-Object System.Drawing.Bitmap(
  $sheetWidth,
  $sheetHeight,
  [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
)
$graphics = [System.Drawing.Graphics]::FromImage($sheet)
$graphics.Clear([System.Drawing.Color]::Transparent)
$graphics.CompositingQuality = 'HighQuality'
$graphics.InterpolationMode = 'HighQualityBicubic'
$graphics.SmoothingMode = 'HighQuality'

$cardBackPath = Join-Path $SourceDir 'dak-and-chog-cardback.png'
$hasCardBack = Test-Path $cardBackPath

for ($suitIndex = 0; $suitIndex -lt $rows; $suitIndex++) {
  for ($rankIndex = 0; $rankIndex -lt $cardColumns; $rankIndex++) {
    $code = $rankCodes[$rankIndex] + $suitCodes[$suitIndex]
    if ($map.ContainsKey($code)) {
      $sourceBitmap = New-Object System.Drawing.Bitmap($map[$code])
      $destRect = New-Object System.Drawing.Rectangle(
        $rankIndex * $tileWidth,
        $suitIndex * $tileHeight,
        $tileWidth,
        $tileHeight
      )
      $graphics.DrawImage($sourceBitmap, $destRect)
      $sourceBitmap.Dispose()
    }
  }

  if ($hasCardBack) {
    $cardBack = New-Object System.Drawing.Bitmap($cardBackPath)
    $destRect = New-Object System.Drawing.Rectangle(
      ($cols - 1) * $tileWidth,
      $suitIndex * $tileHeight,
      $tileWidth,
      $tileHeight
    )
    $graphics.DrawImage($cardBack, $destRect)
    $cardBack.Dispose()
  }
}

$graphics.Dispose()
$outputPath = Join-Path $OutDir $OutFile
$sheet.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose()

Write-Host "[OK] Wrote spritesheet: $outputPath ($sheetWidth x $sheetHeight)"
