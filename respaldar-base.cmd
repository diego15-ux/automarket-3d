@echo off
rem AutoMarket 3D - copia de seguridad de la base de datos en la carpeta respaldos.
rem MySQL de XAMPP tiene que estar encendido (AutoMarket.exe lo enciende).
rem Se guardan las ultimas 30 copias. AutoMarket tambien hace una sola al dia al abrirse.
cd /d "%~dp0"
echo.
node scripts\respaldar-base.mjs
echo.
pause
