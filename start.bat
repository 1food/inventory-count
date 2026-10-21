@echo off
setlocal
cd /d "%~dp0"

if not defined V3_PORT if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="V3_PORT" set "V3_PORT=%%b"
if not defined V3_PORT set "V3_PORT=8200"
if not defined V3_HOST set "V3_HOST=0.0.0.0"

echo ============================================
echo   Inventory Survey (Jaemul Josa)
echo ============================================
echo.

if not exist ".env" copy ".env.example" ".env" >nul
rem First run (no access code yet): open the setup page in the browser once the server is up.
findstr /r /c:"^ACCESS_CODE=..*" ".env" >nul 2>&1
if errorlevel 1 start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 6; Start-Process 'http://localhost:%V3_PORT%/setup'"

echo [1/2] Checking Python and packages...
call "%~dp0scripts\prepare-runtime.bat"
if errorlevel 1 goto :install_error
echo       Python: %PYTHON_EXE%
echo       Runtime: %RUNTIME_DIR%

echo [2/2] Starting the server...
echo.
echo   URL: http://localhost:%V3_PORT%
echo   Internal network: http://SERVER-IP:%V3_PORT%
echo   Check this PC's IPv4 address below:
ipconfig | findstr /c:"IPv4"
echo.
echo   Press Ctrl+C to stop.
echo   NOTE: "http://0.0.0.0:%V3_PORT%" printed below is NOT an address to open.
echo         On this PC open http://localhost:%V3_PORT%  /  on phones use http://IPv4-ADDRESS:%V3_PORT%
echo         For access from outside, run start-external.bat and use the https address it shows.
echo.
:run
"%PYTHON_EXE%" -m uvicorn app.main:app --host %V3_HOST% --port %V3_PORT%
rem Exit code 3 = settings saved on the setup page; start again with the new settings.
if "%ERRORLEVEL%"=="3" (
    echo.
    echo Settings saved. Restarting the server...
    goto :run
)
echo.
echo Server stopped. Creating a saved data backup...
call "%~dp0backup.bat" --quiet
if errorlevel 1 echo [WARNING] Automatic backup failed. Run backup.bat after checking Python.
goto :end

:install_error
echo.
echo [ERROR] Python or package preparation failed.
echo If the "python" folder is missing, download the full package again.
echo Otherwise check the internet connection and try again.

:end
echo.
pause
