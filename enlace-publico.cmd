@echo off
rem AutoMarket 3D - enlace publico temporal con Cloudflare (sin cuenta y sin dominio).
rem Abre AutoMarket.exe primero. El enlace funciona mientras esta ventana este abierta.
cd /d "%~dp0"
set "CF="
where cloudflared >nul 2>&1 && set "CF=cloudflared"
if not defined CF if exist "%~dp0cloudflared.exe" set "CF=%~dp0cloudflared.exe"
if not defined CF if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
if not defined CF if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not defined CF goto falta
echo.
echo Buscando un enlace publico para http://localhost:3000 ...
echo Abajo sale una linea con https://algo.trycloudflare.com : ese es tu enlace.
echo Cualquiera que lo tenga puede abrir la pagina. Cierra esta ventana para apagarlo.
echo.
"%CF%" tunnel --url http://localhost:3000
echo.
pause
exit /b 0

:falta
echo.
echo No encontre cloudflared en esta PC. Instalalo una sola vez:
echo   1. Abre "Simbolo del sistema" o "Terminal".
echo   2. Escribe:  winget install --id Cloudflare.cloudflared
echo   3. Cuando termine, vuelve a abrir este archivo.
echo.
pause
exit /b 1
