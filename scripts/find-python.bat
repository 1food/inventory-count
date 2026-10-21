@echo off
rem Finds Python and exports PYTHON_EXE/PYTHON_TAG to the calling batch file.
rem Priority: explicit path, Python Launcher (3.14 first), system/current-user
rem           install, project venv, then PATH.

set "PYTHON_EXE="
set "PYTHON_TAG="

if not "%~1"=="" if exist "%~1" set "PYTHON_EXE=%~1"
rem Portable package: bundled Python in .\python comes first.
if not defined PYTHON_EXE if exist "%CD%\python\python.exe" set "PYTHON_EXE=%CD%\python\python.exe"
if not defined PYTHON_EXE if defined V3_PYTHON_EXE if exist "%V3_PYTHON_EXE%" set "PYTHON_EXE=%V3_PYTHON_EXE%"

rem Resolve the actual interpreter through py.exe, preferring Python 3.14.
if not defined PYTHON_EXE for %%V in (14 13 12 11 10) do if not defined PYTHON_EXE for /f "usebackq delims=" %%P in (`py -3.%%V -c "import sys; print(sys.executable)" 2^>nul`) do if exist "%%P" set "PYTHON_EXE=%%P"

rem System-wide locations are visible to the Task Scheduler SYSTEM account.
if not defined PYTHON_EXE for %%V in (314 313 312 311 310) do if not defined PYTHON_EXE if exist "%ProgramFiles%\Python%%V\python.exe" set "PYTHON_EXE=%ProgramFiles%\Python%%V\python.exe"
if not defined PYTHON_EXE for %%V in (314 313 312 311 310) do if not defined PYTHON_EXE if exist "%ProgramFiles%\Python\Python%%V\python.exe" set "PYTHON_EXE=%ProgramFiles%\Python\Python%%V\python.exe"

rem Current-user installs are available during an interactive/manual start.
if not defined PYTHON_EXE for %%V in (314 313 312 311 310) do if not defined PYTHON_EXE if exist "%LocalAppData%\Programs\Python\Python%%V\python.exe" set "PYTHON_EXE=%LocalAppData%\Programs\Python\Python%%V\python.exe"
if not defined PYTHON_EXE if exist "%CD%\.venv\Scripts\python.exe" set "PYTHON_EXE=%CD%\.venv\Scripts\python.exe"
if not defined PYTHON_EXE for /f "delims=" %%P in ('where python.exe 2^>nul') do if not defined PYTHON_EXE set "PYTHON_EXE=%%P"

if not defined PYTHON_EXE exit /b 1
"%PYTHON_EXE%" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if errorlevel 1 (
    set "PYTHON_EXE="
    exit /b 1
)
for /f "delims=" %%V in ('call "%PYTHON_EXE%" -c "import sys; print(str(sys.version_info.major) + str(sys.version_info.minor))"') do set "PYTHON_TAG=%%V"
if not defined PYTHON_TAG (
    set "PYTHON_EXE="
    exit /b 1
)
set "V3_PYTHON_EXE=%PYTHON_EXE%"
exit /b 0
