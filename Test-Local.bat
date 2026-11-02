@echo off
title Garda CAD - local test
cd /d "%~dp0"
call npm install
start "" http://localhost:8787
call npx wrangler dev
