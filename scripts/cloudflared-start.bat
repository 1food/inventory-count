@echo off
setlocal enabledelayedexpansion
rem Starts the Cloudflare named tunnel in the background (no console window).
rem Called by the "InventoryCountServer-Cloudflare-AutoStart" scheduled task (SYSTEM account, runs at boot).
cd /d "%~dp0.."

if not exist "data" mkdir "data"
echo [%date% %time%] cloudflared-start.bat started (running as %USERNAME%) >> "data\cloudflared.log"

set "CFD="
if exist "cloudflared.exe" set "CFD=%CD%\cloudflared.exe"
if not defined CFD (
    echo [%date% %time%] ERROR: cloudflared.exe not found >> "data\cloudflared.log"
    goto :eof
)
echo [%date% %time%] CFD=%CFD% >> "data\cloudflared.log"

set "TOKEN="
if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do call :checkline "%%a" "%%b"

if not defined TOKEN (
    rem No token: open a quick tunnel. Its random https://*.trycloudflare.com address is written to the log.
    if not defined V3_PORT if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="V3_PORT" set "V3_PORT=%%b"
    if not defined V3_PORT set "V3_PORT=8200"
    echo [%date% %time%] no token - starting QUICK tunnel to port !V3_PORT! ^(address below^) >> "data\cloudflared.log"
    "%CFD%" tunnel --no-autoupdate --url http://localhost:!V3_PORT! >> "data\cloudflared.log" 2>&1
    echo [%date% %time%] cloudflared exited ^(code=!errorlevel!^) >> "data\cloudflared.log"
    goto :eof
)

echo [%date% %time%] starting named tunnel >> "data\cloudflared.log"
"%CFD%" tunnel run --token "!TOKEN!" >> "data\cloudflared.log" 2>&1
echo [%date% %time%] cloudflared exited (code=%errorlevel%) >> "data\cloudflared.log"
goto :eof

:checkline
set "K=%~1"
set "V=%~2"
if /i "%K%"=="CLOUDFLARE_TUNNEL_TOKEN" set "TOKEN=%V%"
goto :eof
