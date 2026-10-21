@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "QUIET=0"
set "BACKUP_EXIT_CODE=0"
if /i "%~1"=="--quiet" set "QUIET=1"

call "%~dp0scripts\find-python.bat"
if errorlevel 1 (
    echo [ERROR] Python was not found. The backup could not be created.
    set "BACKUP_EXIT_CODE=1"
    goto :end
)

set "SOURCE=%CD%\data"
rem Backup folder: BACKUP_DIR in .env (e.g. an external drive or NAS), otherwise .\backups
set "BACKUP_ROOT="
if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="BACKUP_DIR" set "BACKUP_ROOT=%%b"
if not defined BACKUP_ROOT set "BACKUP_ROOT=%CD%\backups"
if not exist "%SOURCE%\" (
    echo [ERROR] Data folder was not found: "%SOURCE%"
    set "BACKUP_EXIT_CODE=1"
    goto :end
)

for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "[DateTime]::UtcNow.AddHours(9).ToString('yyyyMMdd_HHmmss_fffffff')"`) do set "STAMP=%%T"
if not defined STAMP set "STAMP=backup"
set "TARGET=%BACKUP_ROOT%\%STAMP%"

echo.
echo Creating backup in "%BACKUP_ROOT%"...
"%PYTHON_EXE%" "%~dp0scripts\backup_data.py" "%SOURCE%" "%TARGET%"
if errorlevel 1 (
    echo [ERROR] Backup was not created.
    set "BACKUP_EXIT_CODE=1"
) else (
    echo Saved data backup is ready.
)

:end
if "%QUIET%"=="0" (
    echo.
    pause
)
endlocal & exit /b %BACKUP_EXIT_CODE%
