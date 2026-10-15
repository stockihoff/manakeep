@echo off
rem Installs or updates Manakeep. Running it again replaces the old version and keeps your collection and decks.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launcher\install-windows.ps1"
echo.
pause
