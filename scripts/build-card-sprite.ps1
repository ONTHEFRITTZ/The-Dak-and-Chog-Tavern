param(
  [string]$SourceDir = 'assets/images/chog_cards',
  [string]$OutDir = 'assets/images/cards',
  [string]$OutFile = 'cards-sprite.png'
)
Add-Type -AssemblyName System.Drawing
if (-not (Test-Path $SourceDir)) { throw "SourceDir not found: $SourceDir" }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$rankNames = @('ace','two','three','four','five','six','seven','eight','nine','ten','jack','queen','king')
$rankCodes = @('A','2','3','4','5','6','7','8','9','T','J','Q','K')
$suitNames = @('spades','hearts','diamonds','clubs') # rows S,H,D,C
$suitCodes = @('S','H','D','C')
# Build map: code -> file
$files = Get-ChildItem -Recurse -File $SourceDir | Where-Object { $_.Name -like 'chog-*-of-*.png' }
$map = @{}
foreach ($f in $files) {
  if ($f.Name -match 'chog-([a-z]+)-of-([a-z]+)\.png') {
    $rname = $Matches[1]; $sname=$Matches[2]
    $ri = [array]::IndexOf($rankNames,$rname)
    $si = [array]::IndexOf($suitNames,$sname)
    if ($ri -ge 0 -and $si -ge 0) {
      $code = $rankCodes[$ri] + $suitCodes[$si]
      $map[$code] = $f.FullName
    }
  }
}
# Validate full deck
$missing = @()
for($si=0;$si -lt $suitCodes.Count;$si++){
  for($ci=0;$ci -lt $rankCodes.Count;$ci++){
    $code = $rankCodes[$ci] + $suitCodes[$si]
    if (-not $map.ContainsKey($code)) { $missing += $code }
  }
}
if ($missing.Count -gt 0) { Write-Host "[WARN] Missing cards: $($missing -join ', ')" }
# Determine tile size from the first present card
$firstPath = $map.Values | Select-Object -First 1
if (-not $firstPath) { throw 'No card images found' }
$firstBmp = New-Object System.Drawing.Bitmap($firstPath)
$tileW = $firstBmp.Width; $tileH = $firstBmp.Height
$firstBmp.Dispose()
$cols = $rankCodes.Count; $rows = $suitCodes.Count
$sheetW = $cols * $tileW; $sheetH = $rows * $tileH
$sheet = New-Object System.Drawing.Bitmap($sheetW, $sheetH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gfx = [System.Drawing.Graphics]::FromImage($sheet)
$gfx.Clear([System.Drawing.Color]::Transparent)
$gfx.CompositingQuality = 'HighQuality'
$gfx.InterpolationMode = 'HighQualityBicubic'
$gfx.SmoothingMode = 'HighQuality'
for($si=0;$si -lt $rows;$si++){
  for($ci=0;$ci -lt $cols;$ci++){
    $code = $rankCodes[$ci] + $suitCodes[$si]
    if ($map.ContainsKey($code)) {
      $bmp = New-Object System.Drawing.Bitmap($map[$code])
      $dest = New-Object System.Drawing.Rectangle($ci*$tileW, $si*$tileH, $tileW, $tileH)
      $gfx.DrawImage($bmp, $dest)
      $bmp.Dispose()
    }
  }
}
$gfx.Dispose()
$outPath = Join-Path $OutDir $OutFile
$sheet.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose()
Write-Host "[OK] Wrote spritesheet: $outPath ($sheetW x $sheetH)"
