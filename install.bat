@echo off
title Garda CAD - Installer
cd /d "%~dp0"
echo ============================================
echo           GARDA CAD - INSTALLER
echo ============================================
echo.
where node >nul 2>nul
if %errorlevel%==0 (
  for /f "delims=" %%v in ('node -v') do echo Node.js %%v is already installed.
  goto done
)
echo Node.js was not found. Installing Node.js LTS with winget...
echo (Accept any prompts that appear.)
echo.
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
if %errorlevel% neq 0 (
  echo.
  echo Automatic install failed. Opening the Node.js download page...
  echo Install the "LTS" version, then run install.bat again.
  start https://nodejs.org/en/download
  pause
  exit /b 1
)
:done
echo.
echo ============================================
echo  Install complete!
echo  Double-click Deploy.bat to put the CAD on Cloudflare.
echo  (If Node was just installed, close this
echo   window first so Windows picks it up.)
echo ============================================
pause
