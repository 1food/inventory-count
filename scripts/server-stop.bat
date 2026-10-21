@echo off
rem Stops the inventory-count server right now, safely (for manual use).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server-stop.ps1"
echo.
echo Server stopped.
pause
