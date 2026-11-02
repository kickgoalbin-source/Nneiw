@echo off
title Garda CAD - Deploy to Cloudflare
cd /d "%~dp0"
call npm install
call npx wrangler login
call npx wrangler deploy
echo.
echo Done. Your CAD address is the https://garda-cad.<your-name>.workers.dev link shown above.
pause
