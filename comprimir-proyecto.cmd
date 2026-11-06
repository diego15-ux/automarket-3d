@echo off
rem AutoMarket 3D - guarda el proyecto en un zip con la base de datos en .sql adentro.
rem MySQL de XAMPP tiene que estar encendido (AutoMarket.exe lo enciende).
rem Todo queda en la carpeta copias-del-proyecto. No incluye node_modules, fotos subidas ni archivos .env.
cd /d "%~dp0"
echo.
node scripts\comprimir-proyecto.mjs
echo.
pause
