# build.ps1 — Assemble Chrome and Firefox extensions from shared source
# Usage:
#   .\build.ps1                # build both
#   .\build.ps1 chrome         # build Chrome only
#   .\build.ps1 firefox        # build Firefox only
#   .\build.ps1 -Zip           # build both + create zip packages
#   .\build.ps1 chrome -Zip    # build Chrome only + zip

param(
    [ValidateSet('all', 'chrome', 'firefox')]
    [string]$Target = 'all',
    [switch]$Zip
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Src = Join-Path $Root 'src'
$Platforms = Join-Path $Root 'platforms'
$Build = Join-Path $Root 'build'

function Build-Extension {
    param([string]$Name)

    $OutDir = Join-Path $Build $Name
    $PlatformDir = Join-Path $Platforms $Name

    # Clean output
    if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
    New-Item -ItemType Directory -Force $OutDir | Out-Null

    # Copy shared source
    Copy-Item (Join-Path $Src 'content.js')  $OutDir
    Copy-Item (Join-Path $Src 'popup.html')  $OutDir
    Copy-Item (Join-Path $Src 'popup.js')    $OutDir
    Copy-Item (Join-Path $Src 'panel.css')   $OutDir
    Copy-Item -Recurse (Join-Path $Src 'lib')   (Join-Path $OutDir 'lib')
    Copy-Item -Recurse (Join-Path $Src 'icons') (Join-Path $OutDir 'icons')

    # Copy platform-specific files (manifest.json, loader.js, etc.)
    Get-ChildItem $PlatformDir -File | ForEach-Object {
        Copy-Item $_.FullName $OutDir
    }

    Write-Host "Built $Name -> build/$Name/"

    if ($Zip) {
        $ZipFile = Join-Path $Build "PESUClaw-$Name.zip"
        if (Test-Path $ZipFile) { Remove-Item -Force $ZipFile }
        Compress-Archive -Path (Join-Path $OutDir '*') -DestinationPath $ZipFile
        Write-Host "Packaged $Name -> build/PESUClaw-$Name.zip"
    }
}

if ($Target -eq 'all' -or $Target -eq 'chrome') {
    Build-Extension 'chrome'
}
if ($Target -eq 'all' -or $Target -eq 'firefox') {
    Build-Extension 'firefox'
}

Write-Host 'Done.'
