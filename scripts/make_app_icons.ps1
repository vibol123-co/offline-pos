<#
.SYNOPSIS
  Makes every app icon size from one square logo, using Windows' built-in System.Drawing
  (nothing to install).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\make_app_icons.ps1 -Source apps_script\web\icons\source-logo.jpg

  Writes into apps_script\web\icons\:
    icon-192.png, icon-512.png       Android home screen / install
    icon-maskable-512.png            Android adaptive icon (logo shrunk into the safe zone)
    apple-touch-icon.png (180)       iPhone / iPad "Add to Home Screen"
    favicon-48.png                   browser tab
  A non-square logo is centre-cropped to a square first.
#>
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$OutDir = "apps_script\web\icons",
  [string]$Background = "#f6f3ef"
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"

if (-not (Test-Path $Source)) { throw "Logo not found: $Source" }
New-Item -ItemType Directory -Force $OutDir | Out-Null

$sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path $Source).Path)
try {
  $side = [Math]::Min($sourceImage.Width, $sourceImage.Height)
  $cropX = [int](($sourceImage.Width - $side) / 2)
  $cropY = [int](($sourceImage.Height - $side) / 2)
  if ($side -lt 512) {
    Write-Warning "The logo is only ${side}x${side}px. Icons will be enlarged and may look soft; 512px or larger is best."
  }
  $bg = [System.Drawing.ColorTranslator]::FromHtml($Background)

  function Save-Icon([int]$size, [string]$name, [double]$scale) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.Clear($bg)
      $inner = [int]([Math]::Round($size * $scale))
      $offset = [int](($size - $inner) / 2)
      $dest = New-Object System.Drawing.Rectangle($offset, $offset, $inner, $inner)
      $graphics.DrawImage($sourceImage, $dest, $cropX, $cropY, $side, $side, [System.Drawing.GraphicsUnit]::Pixel)
      $path = Join-Path $OutDir $name
      $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output ("  {0,-26} {1}x{1}" -f $name, $size)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }

  Write-Output "Icons written to ${OutDir}:"
  Save-Icon 192 "icon-192.png" 1.0
  Save-Icon 512 "icon-512.png" 1.0
  Save-Icon 512 "icon-maskable-512.png" 0.8   # Android crops maskable icons to a circle/shape
  Save-Icon 180 "apple-touch-icon.png" 1.0
  Save-Icon 48  "favicon-48.png" 1.0
} finally {
  $sourceImage.Dispose()
}
