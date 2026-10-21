@echo off
rem Prepares a separate dependency directory for each Python ABI.
rem Example: Python 3.12 -> .runtime-py312, Python 3.14 -> .runtime-py314.

call "%~dp0find-python.bat" "%~1"
if errorlevel 1 (
    echo [ERROR] Python 3.10 or newer was not found.
    exit /b 1
)

set "RUNTIME_DIR=%CD%\.runtime-py%PYTHON_TAG%"
set "PYTHONPATH=%RUNTIME_DIR%"

set "RUNTIME_READY="
if exist "%RUNTIME_DIR%\fastapi\__init__.py" (
    "%PYTHON_EXE%" -c "import fastapi, openpyxl, pydantic_core, uvicorn, webauthn, segno" >nul 2>&1
    if not errorlevel 1 set "RUNTIME_READY=1"
)

if not defined RUNTIME_READY (
    echo [setup] Preparing packages for Python %PYTHON_TAG%...
    if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%"
    "%PYTHON_EXE%" -m pip install --disable-pip-version-check --upgrade --target "%RUNTIME_DIR%" -r "%CD%\requirements.txt"
    if errorlevel 1 (
        echo [ERROR] Package installation failed for Python %PYTHON_TAG%.
        exit /b 1
    )
    "%PYTHON_EXE%" -c "import fastapi, openpyxl, pydantic_core, uvicorn, webauthn, segno" >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Installed packages are not compatible with Python %PYTHON_TAG%.
        exit /b 1
    )
)
exit /b 0
