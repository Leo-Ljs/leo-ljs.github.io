@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo.
  echo Drag a folder onto scan_folder.bat, or run:
  echo   scan_folder.bat "D:\some-folder"
  echo.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo Python was not found. Install Python 3 and enable "Add Python to PATH".
  echo.
  pause
  exit /b 1
)

echo.
echo Scanning: %~1
echo Only names, sizes and modified times are read. Nothing is uploaded.
echo.
set PYTHONIOENCODING=utf-8
python "%~dp0scan_folder.py" "%~1"
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo Scan failed with exit code %EXITCODE%.
) else (
  echo Done. The JSON file is next to the scanned folder.
)
echo.
pause
exit /b %EXITCODE%
