@echo off
:: -------------------------
:: 1️⃣ Check Python installation
:: -------------------------
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo ⚠️ Python not found. Please download and install Python 3.10.x from:
    echo https://www.python.org/downloads/windows/
    pause
    exit /b
)

:: Check Python version >=3.10
for /f "tokens=2 delims= " %%a in ('python --version') do set PYVER=%%a
for /f "tokens=1,2 delims=." %%i in ("%PYVER%") do (
    set MAJOR=%%i
    set MINOR=%%j
)
if %MAJOR% LSS 3 (
    echo ⚠️ Python version must be >= 3.10
    pause
    exit /b
)
if %MAJOR%==3 if %MINOR% LSS 10 (
    echo ⚠️ Python version must be >= 3.10
    pause
    exit /b
)

echo ✅ Python %PYVER% detected.

:: -------------------------
:: 2️⃣ Check pip packages
:: -------------------------
python -m pip show flask >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Installing Flask...
    python -m pip install flask
) else (
    echo ✅ Flask already installed.
)

python -m pip show pyhanko >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Installing pyHanko...
    python -m pip install pyhanko
) else (
    echo ✅ pyHanko already installed.
)

:: -------------------------
:: 3️⃣ Run local signer
:: -------------------------
echo 🚀 Starting Local Signer...
cd /d %~dp0
python local_signer.py

pause