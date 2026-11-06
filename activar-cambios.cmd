@echo off
rem AutoMarket 3D - activa los cambios de la fase 1 (base de datos + API).
rem 1) Aplica la migracion nueva  2) Genera el cliente de Prisma  3) Reinicia la API si esta corriendo con dev:api
setlocal
cd /d "%~dp0"
set "LOG=%~dp0activar-cambios.log"
echo AutoMarket 3D - activar cambios > "%LOG%"
echo %date% %time% >> "%LOG%"

echo.
echo [1/3] Aplicando la migracion a la base de datos...
echo ===== db:deploy ===== >> "%LOG%"
call npm run db:deploy -w @automarket/api >> "%LOG%" 2>&1
if errorlevel 1 goto fallo

echo [2/3] Generando el cliente de Prisma...
echo ===== db:generate ===== >> "%LOG%"
call npm run db:generate -w @automarket/api >> "%LOG%" 2>&1
if errorlevel 1 goto fallo

echo [3/3] Reiniciando la API (solo si esta corriendo con npm run dev:api)...
echo ===== reinicio api ===== >> "%LOG%"
powershell -NoProfile -Command "(Get-Item 'apps\api\src\main.ts').LastWriteTime = Get-Date" >> "%LOG%" 2>&1

echo ===== LISTO ===== >> "%LOG%"
echo.
echo LISTO. Todo salio bien. Esta ventana se cierra sola en 30 segundos.
timeout /t 30 >nul
exit /b 0

:fallo
echo ===== FALLO ===== >> "%LOG%"
echo.
echo Algo fallo. El detalle quedo en activar-cambios.log
echo.
type "%LOG%"
echo.
echo Esta ventana se cierra sola en 120 segundos.
timeout /t 120 >nul
exit /b 1
