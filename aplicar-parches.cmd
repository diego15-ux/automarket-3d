@echo off
rem AutoMarket 3D - aplica textos corregidos en paginas de carpetas muy profundas
rem (Claude no llega a escribirlas desde la nube). Solo cambia el texto exacto
rem de scripts\parches.json y guarda una copia en scripts\parches-respaldo.
cd /d "%~dp0"
echo.
node scripts\aplicar-parches.mjs
echo.
pause
