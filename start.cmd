@echo off
rem Kota Hustle server, the lean way (Windows): double-click this after "npm run build".
rem It runs Node directly, without npm and cross-env in between (~80 MB less memory), and with a
rem small young-generation heap (Node reserves ~64 MB for it on PCs with lots of RAM otherwise).
rem Same as "npm start" otherwise. Ctrl+C saves everyone and stops the server.
cd /d "%~dp0"
if not exist server\dist\index.js (
  echo Build it first: npm run build
  pause
  exit /b 1
)
node --max-semi-space-size=2 server/dist/index.js
pause
