@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

if not defined V3_PORT if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="V3_PORT" set "V3_PORT=%%b"
if not defined V3_PORT set "V3_PORT=8200"

echo ============================================
echo   Inventory Survey - External Access (Cloudflare)
echo ============================================
echo.

REM ---- 1) Locate cloudflared in this folder (download on first run) ----
set "CFD="
if exist "cloudflared.exe" set "CFD=cloudflared.exe"
if not defined CFD (
    echo [setup] Downloading cloudflared ... ^(first run only^)
    curl -L -o cloudflared.exe "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    if errorlevel 1 goto :dlfail
    set "CFD=cloudflared.exe"
)

REM ---- 2) Start the server in a separate window ----
echo [1/2] Starting the server in a new window (port %V3_PORT%)...
start "Inventory server" cmd /c "start.bat"
echo       Waiting a few seconds for the server to come up...
timeout /t 6 /nobreak >nul

REM ---- 3) Read CLOUDFLARE_TUNNEL_TOKEN from .env in this folder ----
set "TOKEN="
if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do call :checkline "%%a" "%%b"

if defined TOKEN goto :named

echo [2/2] Starting a QUICK tunnel (a random https URL will appear below)...
echo.
echo   NOTE: Passkeys require a fixed domain, so they will NOT work on a random
echo         trycloudflare.com URL. Access-code login works fine.
echo         For passkeys, set up a named tunnel (see below) mapped to
echo         http://localhost:%V3_PORT% and put its token in .env as
echo         CLOUDFLARE_TUNNEL_TOKEN=...
echo ============================================
echo.
"%CFD%" tunnel --url http://localhost:%V3_PORT%
goto :end

:named
echo [2/2] Starting the NAMED tunnel (fixed domain from your Cloudflare dashboard)...
echo.
echo   Make sure the tunnel's Public Hostname points to:
echo       Service = http://localhost:%V3_PORT%
echo ============================================
echo.
"%CFD%" tunnel run --token "!TOKEN!"
goto :end

:checkline
set "K=%~1"
set "V=%~2"
if /i "%K%"=="CLOUDFLARE_TUNNEL_TOKEN" set "TOKEN=%V%"
goto :eof

:dlfail
echo.
echo [ERROR] Failed to download cloudflared. Check your internet connection.

:end
echo.
pause
