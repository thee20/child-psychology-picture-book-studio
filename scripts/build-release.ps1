# Build desktop runtime + Windows installer (Inno Setup)
$ErrorActionPreference = 'Stop'
$root = if ($PSScriptRoot) { Split-Path $PSScriptRoot -Parent } else { (Get-Location).Path }
$version = '1.3.4'
$dist = Join-Path $root 'dist'
$appDir = Join-Path $dist 'app'
$iscc = @(
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
  'C:\Program Files\Inno Setup 6\ISCC.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1

Write-Host "Root: $root"
Write-Host "Building desktop shell..."
# Resolve Chinese-named build script without hardcoding broken nested encodings
$desktopBuild = Get-ChildItem -LiteralPath $root -Filter '*.ps1' -File |
  Where-Object { $_.Name -like '*桌面*' -or $_.Name -eq '生成桌面程序.ps1' } |
  Select-Object -First 1
if (-not $desktopBuild) {
  $desktopBuild = Get-ChildItem -LiteralPath $root -Filter '*.ps1' -File |
    Where-Object { $_.Length -gt 3000 -and (Get-Content -LiteralPath $_.FullName -TotalCount 5 -ErrorAction SilentlyContinue | Out-String) -match 'PictureBookStudio|WebView2|desktop-runtime' } |
    Select-Object -First 1
}
if (-not $desktopBuild) { throw 'Desktop build script (生成桌面程序.ps1) not found.' }
Write-Host "Using desktop build: $($desktopBuild.FullName)"
& $desktopBuild.FullName
if ($LASTEXITCODE -ne 0 -and -not $?) { throw 'Desktop build failed.' }
# Some scripts don't set LASTEXITCODE; verify outputs instead

$launcher = Join-Path $root 'PictureBookStudio-Launcher.exe'
$runtime = Join-Path $root 'desktop-runtime'
if (-not (Test-Path -LiteralPath $launcher)) { throw "Missing launcher: $launcher" }
if (-not (Test-Path -LiteralPath (Join-Path $runtime 'PictureBookStudio.exe'))) {
  throw 'Missing desktop-runtime/PictureBookStudio.exe'
}

Write-Host "Staging app package..."
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path $appDir | Out-Null

$copyMap = @(
  @{ Src = 'PictureBookStudio-Launcher.exe'; Dest = 'PictureBookStudio-Launcher.exe' },
  @{ Src = 'app.ico'; Dest = 'app.ico' },
  @{ Src = 'server.js'; Dest = 'server.js' },
  @{ Src = 'package.json'; Dest = 'package.json' },
  @{ Src = 'desktop-launcher.cs'; Dest = 'desktop-launcher.cs' },
  @{ Src = '备用启动.cmd'; Dest = '备用启动.cmd' },
  @{ Src = '生成桌面程序.ps1'; Dest = '生成桌面程序.ps1' },
  @{ Src = 'README.md'; Dest = 'README.md' },
  @{ Src = 'README.zh-CN.md'; Dest = 'README.zh-CN.md' },
  @{ Src = '.env.example'; Dest = '.env.example' }
)

foreach ($item in $copyMap) {
  $src = Join-Path $root $item.Src
  if (Test-Path -LiteralPath $src) {
    Copy-Item -LiteralPath $src -Destination (Join-Path $appDir $item.Dest) -Force
  }
}

Copy-Item -LiteralPath (Join-Path $root 'public') -Destination (Join-Path $appDir 'public') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'scripts') -Destination (Join-Path $appDir 'scripts') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'desktop') -Destination (Join-Path $appDir 'desktop') -Recurse -Force -ErrorAction SilentlyContinue
# strip desktop build trash if copied
$bin = Join-Path $appDir 'desktop\bin'
$obj = Join-Path $appDir 'desktop\obj'
if (Test-Path $bin) { Remove-Item $bin -Recurse -Force }
if (Test-Path $obj) { Remove-Item $obj -Recurse -Force }
Copy-Item -LiteralPath $runtime -Destination (Join-Path $appDir 'desktop-runtime') -Recurse -Force

# empty data scaffold (no secrets)
$data = Join-Path $appDir 'data'
New-Item -ItemType Directory -Force -Path (Join-Path $data 'projects') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $data 'knowledge') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $data 'exports') | Out-Null
Set-Content -Path (Join-Path $data '.gitkeep') -Value '' -Encoding UTF8

# Portable zip
$zipName = "ChildPsychologyPictureBookStudio-Portable-$version.zip"
$zipPath = Join-Path $dist $zipName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $appDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
Write-Host "Portable: $zipPath"

# Inno Setup installer
if (-not $iscc) {
  Write-Warning 'Inno Setup ISCC.exe not found. Portable zip only.'
} else {
  Write-Host "Compiling installer with $iscc"
  $iss = Join-Path $root 'installer\PictureBookStudio.iss'
  & $iscc $iss
  if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compile failed.' }
  $setup = Join-Path $dist "ChildPsychologyPictureBookStudio-Setup-$version.exe"
  if (-not (Test-Path $setup)) { throw "Installer not produced: $setup" }
  Write-Host "Installer: $setup"
}

Write-Host 'Release build done.'
Get-ChildItem $dist -File | Format-Table Name, Length
