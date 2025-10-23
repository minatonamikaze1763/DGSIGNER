@echo off
echo Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python not found! Please install Python 3.8+ manually first.
    pause
    exit /b
)

echo Installing required packages...
pip install -r requirements.txt
echo.
echo ✅ All requirements installed successfully!
pause