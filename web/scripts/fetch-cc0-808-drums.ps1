# Fetches CC0 TR-808 one-shots (Michael Fischer, 1994) into web/public/assets/drums/
# License: CC0 — https://github.com/tidalcycles/sounds-tr808-fischer
#
# From repo root:
#   powershell -File web/scripts/fetch-cc0-808-drums.ps1
#   powershell -File web/scripts/fetch-cc0-808-drums.ps1 -Profile punchy
#   powershell -File web/scripts/fetch-cc0-808-drums.ps1 -Profile soft

param(
  [ValidateSet('default', 'punchy', 'soft')]
  [string]$Profile = 'default'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$dest = Join-Path $repoRoot 'web\public\assets\drums'
$base = 'https://raw.githubusercontent.com/tidalcycles/sounds-tr808-fischer/main'

$profiles = @{
  default = @{
    kick    = 'bd8/BD5050.WAV'
    snare   = 'sd8/SD5050.WAV'
    clap    = 'cp8/CP.WAV'
    hat     = 'ch8/CH.WAV'
    openhat = 'oh8/OH50.WAV'
  }
  punchy = @{
    kick    = 'bd8/BD5000.WAV'
    snare   = 'sd8/SD5000.WAV'
    clap    = 'cp8/CP.WAV'
    hat     = 'ch8/CH.WAV'
    openhat = 'oh8/OH50.WAV'
  }
  soft = @{
    kick    = 'bd8/BD7525.WAV'
    snare   = 'sd8/SD7525.WAV'
    clap    = 'cp8/CP.WAV'
    hat     = 'ch8/CH.WAV'
    openhat = 'oh8/OH75.WAV'
  }
}

$map = $profiles[$Profile]
New-Item -ItemType Directory -Force -Path $dest | Out-Null

Write-Host "Profile: $Profile (CC0 TR-808 Fischer)"
foreach ($entry in $map.GetEnumerator()) {
  $name = $entry.Key
  $path = $entry.Value
  $out = Join-Path $dest "$name.wav"
  $url = "$base/$path"
  Write-Host "GET $url -> $out"
  Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
}

Write-Host "Done. Hard-refresh the app after audio start() so samples reload."
