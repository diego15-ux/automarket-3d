@echo off
rem AutoMarket 3D - borra los datos de prueba: cuentas @automarket.test y todo lo suyo
rem (autos, fotos, chats, reservas, ventas, pagos, destacados, resenas, avisos).
rem Las cuentas reales no se tocan. Mejor con AutoMarket.exe abierto (asi tambien borra las fotos).
cd /d "%~dp0"
set "LOG=%~dp0borrar-datos-prueba.log"
echo.
echo Esto borra TODAS las cuentas @automarket.test y todo lo suyo. Las cuentas reales no se tocan.
choice /C SN /N /M "Escribe S para borrar o N para salir: "
if errorlevel 2 goto salir
echo AutoMarket 3D - borrar datos de prueba > "%LOG%"
echo %date% %time% >> "%LOG%"
echo Borrando... (tarda unos segundos)
call npm run db:prueba:borrar -w @automarket/api >> "%LOG%" 2>&1 || goto fallo
type "%LOG%"
echo.
echo Listo. Recarga la pagina de AutoMarket en el navegador.
pause
exit /b 0
:salir
echo No se borro nada.
pause
exit /b 0
:fallo
type "%LOG%"
echo.
echo Algo fallo (el detalle quedo en borrar-datos-prueba.log). Si no conecta con la base, abre primero AutoMarket.exe.
pause
exit /b 1
