@echo off
rem AutoMarket 3D - crea o actualiza las cuentas y autos de prueba de varios paises, con imagenes de prueba
rem (correos @automarket.test). Necesita AutoMarket.exe abierto (MySQL y el almacen de imagenes encendidos).
cd /d "%~dp0"
set "LOG=%~dp0crear-datos-prueba.log"
echo AutoMarket 3D - datos de prueba > "%LOG%"
echo %date% %time% >> "%LOG%"
echo Creando cuentas, autos e imagenes de prueba... (tarda unos segundos)
call npm run db:seed -w @automarket/api >> "%LOG%" 2>&1 || goto fallo
call npm run db:seed:prueba -w @automarket/api >> "%LOG%" 2>&1 || goto fallo
type "%LOG%"
echo.
echo Listo. Recarga la pagina de AutoMarket en el navegador.
pause
exit /b 0
:fallo
type "%LOG%"
echo.
echo Algo fallo (el detalle quedo en crear-datos-prueba.log). Si no conecta con la base, abre primero AutoMarket.exe.
pause
exit /b 1
