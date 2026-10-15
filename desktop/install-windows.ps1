# Manakeep installer / updater / uninstaller for Windows.
# Installs the app to %LOCALAPPDATA%\Programs\Manakeep and adds Desktop + Start menu shortcuts.
# Running it again replaces the old version. Your collection and decks are never touched: they live in your
# save folder and in your browser's own storage, not in the program folder.
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
Set-Location $env:TEMP

$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Manakeep'
$Programs   = [Environment]::GetFolderPath('Programs')
$StartDir   = Join-Path $Programs 'Manakeep'
$Desktop    = [Environment]::GetFolderPath('Desktop')
$PinDir     = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
$UninstKey  = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Manakeep'
$AppFiles   = @('Manakeep.html', 'manakeep.ico', 'uninstall.ps1')
$Shell      = New-Object -ComObject WScript.Shell
$PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Get-AppVersion($html) {
  if (-not (Test-Path $html)) { return $null }
  $m = Select-String -Path $html -Pattern 'name="manakeep-version" content="([^"]+)"' -List
  if ($m) { return $m.Matches[0].Groups[1].Value }
  return 'an earlier version'
}

function Remove-AppFiles {
  # Shortcuts made by any earlier version (they only ever point at the program)
  foreach ($p in @((Join-Path $Desktop 'Manakeep.lnk'), (Join-Path $Programs 'Manakeep.lnk'), $StartDir)) {
    if (Test-Path $p) { Remove-Item $p -Recurse -Force }
  }
  # The program itself: only the files Manakeep put there, then the folder if it's empty
  if (Test-Path $InstallDir) {
    foreach ($f in $AppFiles) { $p = Join-Path $InstallDir $f; if (Test-Path $p) { Remove-Item $p -Force } }
    if (-not (Get-ChildItem $InstallDir -Force)) { Remove-Item $InstallDir -Force }
  }
  if (Test-Path $UninstKey) { Remove-Item $UninstKey -Recurse -Force }
}

function New-Shortcut($path, $target, $arguments, $icon, $desc) {
  $l = $Shell.CreateShortcut($path)
  $l.TargetPath = $target; $l.Arguments = $arguments; $l.WorkingDirectory = $InstallDir
  if ($icon -and (Test-Path $icon)) { $l.IconLocation = "$icon,0" }
  $l.Description = $desc; $l.Save()
}

function Find-Browser {
  foreach ($exe in 'msedge.exe', 'chrome.exe', 'brave.exe') {
    foreach ($hive in 'HKCU:', 'HKLM:') {
      $key = "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe"
      if (Test-Path $key) {
        $v = (Get-ItemProperty -Path $key).'(default)'
        if ($v) { $v = $v.Trim('"') }
        if ($v -and (Test-Path $v)) { return $v }
      }
    }
  }
  foreach ($c in @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
                   "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
                   "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe")) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  return $null
}

# ---------------- uninstall ----------------
if ($Uninstall) {
  Write-Host 'This removes the Manakeep program and its shortcuts.'
  Write-Host 'Your collection and decks are kept (they live in your save folder and your browser storage).'
  $a = Read-Host 'Remove Manakeep? (Y/N)'
  if ($a -notmatch '^[Yy]') { exit 0 }
  Remove-AppFiles
  $pin = Join-Path $PinDir 'Manakeep.lnk'; if (Test-Path $pin) { Remove-Item $pin -Force }
  Write-Host 'Manakeep has been removed. Your collection and decks are still where you saved them.' -ForegroundColor Green
  Read-Host 'Press Enter to close' | Out-Null
  exit 0
}

# ---------------- install / update ----------------
$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root 'Manakeep.html'
if (-not (Test-Path $src)) { Write-Host "Couldn't find Manakeep.html in $root" -ForegroundColor Red; exit 1 }
if ((Resolve-Path $root).Path.TrimEnd('\') -ieq $InstallDir.TrimEnd('\')) { Write-Host 'Run the installer from the downloaded Manakeep folder, not from the program folder.' -ForegroundColor Red; exit 1 }

$browser = Find-Browser
if (-not $browser) { Write-Host 'Manakeep needs Microsoft Edge or Google Chrome (for saving to a folder). Install one and run this again.' -ForegroundColor Yellow; exit 1 }

$oldV = Get-AppVersion (Join-Path $InstallDir 'Manakeep.html')
$newV = Get-AppVersion $src
if ($oldV) { Write-Host "Removing the old version ($oldV)..." }
Remove-AppFiles

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item $src (Join-Path $InstallDir 'Manakeep.html') -Force
Copy-Item (Join-Path $PSScriptRoot 'manakeep.ico') (Join-Path $InstallDir 'manakeep.ico') -Force
Copy-Item $PSCommandPath (Join-Path $InstallDir 'uninstall.ps1') -Force

$html = Join-Path $InstallDir 'Manakeep.html'
$icon = Join-Path $InstallDir 'manakeep.ico'
$url  = ([System.Uri]$html).AbsoluteUri
$appArgs = "--app=`"$url`" --window-size=1440,920"
$unArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'uninstall.ps1')`" -Uninstall"

New-Item -ItemType Directory -Path $StartDir -Force | Out-Null
New-Shortcut (Join-Path $Desktop 'Manakeep.lnk') $browser $appArgs $icon 'Manakeep: MTG collection and deck builder'
New-Shortcut (Join-Path $StartDir 'Manakeep.lnk') $browser $appArgs $icon 'Manakeep: MTG collection and deck builder'
New-Shortcut (Join-Path $StartDir 'Uninstall Manakeep.lnk') $PowerShell $unArgs $icon 'Remove Manakeep (keeps your collection and decks)'
# A taskbar pin from an earlier version keeps working: point it at the new copy
$pin = Join-Path $PinDir 'Manakeep.lnk'
if (Test-Path $pin) { New-Shortcut $pin $browser $appArgs $icon 'Manakeep: MTG collection and deck builder' }

# Show up in Settings > Apps like a normal program (per user, no admin needed)
New-Item -Path $UninstKey -Force | Out-Null
$size = [int]((Get-ChildItem $InstallDir | Measure-Object Length -Sum).Sum / 1KB)
$props = @{ DisplayName = 'Manakeep'; DisplayVersion = $newV; Publisher = 'Manakeep'; DisplayIcon = $icon; InstallLocation = $InstallDir;
            UninstallString = "`"$PowerShell`" $unArgs"; NoModify = 1; NoRepair = 1; EstimatedSize = $size }
foreach ($k in $props.Keys) {
  $type = if ($props[$k] -is [int]) { 'DWord' } else { 'String' }
  New-ItemProperty -Path $UninstKey -Name $k -Value $props[$k] -PropertyType $type -Force | Out-Null
}

Write-Host ''
if ($oldV) { Write-Host "Updated Manakeep: $oldV -> $newV" -ForegroundColor Green } else { Write-Host "Installed Manakeep $newV" -ForegroundColor Green }
Write-Host "Opens in its own window using $(Split-Path -Leaf $browser). Shortcuts are on your Desktop and in the Start menu."
Write-Host 'Your collection and decks are untouched.'
Write-Host 'Tip: right-click Manakeep in the Start menu and choose "Pin to taskbar".'
Write-Host 'To update later, download the new version and run this installer again.'
