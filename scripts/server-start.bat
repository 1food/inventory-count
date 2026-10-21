@echo off
setlocal
rem Starts the inventory-count server in the background (no console window).
rem Called by the "InventoryCountServer-AutoStart" scheduled task (SYSTEM account, runs at boot, no logon needed).
cd /d "%~dp0.."

if not exist "data" mkdir "data"
echo [%date% %time%] server-start.bat started (running as %USERNAME%) >> "data\server.log"

rem The scheduler passes its verified Python path as the first argument.
call "%~dp0prepare-runtime.bat" "%~1" >> "data\server.log" 2>&1
if errorlevel 1 (
    echo [%date% %time%] ERROR: compatible Python/runtime was not found >> "data\server.log"
    goto :eof
)
echo [%date% %time%] PYTHON_EXE=%PYTHON_EXE% >> "data\server.log"
echo [%date% %time%] PYTHON_TAG=%PYTHON_TAG% RUNTIME_DIR=%RUNTIME_DIR% >> "data\server.log"

if not defined V3_PORT if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="V3_PORT" set "V3_PORT=%%b"
if not defined V3_PORT set "V3_PORT=8200"
if not defined V3_HOST set "V3_HOST=0.0.0.0"

echo [%date% %time%] PYTHONPATH=%PYTHONPATH% >> "data\server.log"

echo [%date% %time%] starting uvicorn (host=%V3_HOST% port=%V3_PORT%) >> "data\server.log"
:run
"%PYTHON_EXE%" -m uvicorn app.main:app --host %V3_HOST% --port %V3_PORT% >> "data\server.log" 2>&1
set "UVICORN_EXIT_CODE=%ERRORLEVEL%"
echo [%date% %time%] uvicorn exited (code=%UVICORN_EXIT_CODE%) >> "data\server.log"
if "%UVICORN_EXIT_CODE%"=="3" goto :run
echo [%date% %time%] creating saved-data backup >> "data\server.log"
call "%CD%\backup.bat" --quiet >> "data\server.log" 2>&1
if errorlevel 1 (
    echo [%date% %time%] ERROR: saved-data backup failed >> "data\server.log"
) else (
    echo [%date% %time%] saved-data backup completed >> "data\server.log"
)
