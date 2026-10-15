@echo off
rem Opens Manakeep in its own window. Uses the installed copy if you've run the installer.
setlocal
set "HTML=%LocalAppData%\Programs\Manakeep\Manakeep.html"
if not exist "%HTML%" set "HTML=%~dp0Manakeep.html"
if not exist "%HTML%" (
  echo Couldn't find Manakeep.html. Run "Install Manakeep (Windows).cmd" first.
  pause
  exit /b 1
)
set "U=%HTML:\=/%"
set "B="
for %%P in (
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  "%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"
  "%LocalAppData%\BraveSoftware\Brave-Browser\Application\brave.exe"
) do if not defined B if exist %%P set "B=%%~P"
if not defined B (
  echo Manakeep works best in Microsoft Edge or Google Chrome. Opening in your default browser instead.
  start "" "%HTML%"
  exit /b 0
)
start "" "%B%" --app="file:///%U%" --window-size=1440,920
