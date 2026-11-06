@echo off
rem AutoMarket 3D - arranca en esta ventana la API, la web y el almacen de imagenes en MODO DESARROLLO
rem (recarga al editar el codigo, pero cada pagina tarda en abrir). Para el modo rapido usa AutoMarket.exe.
rem Necesita MySQL encendido en XAMPP. Para detener todo: Ctrl + C o cierra la ventana.
cd /d "%~dp0"
call npm run dev -- --desarrollo
pause
