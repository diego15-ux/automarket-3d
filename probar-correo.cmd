@echo off
rem AutoMarket 3D - manda un correo de prueba con el SMTP_URL de apps\api\.env.
rem Sirve para saber si "Olvide mi contrasena" y los avisos por correo ya llegan.
cd /d "%~dp0"
echo.
set "CORREO="
set /p CORREO=Escribe el correo donde quieres recibir la prueba: 
echo.
node apps\api\scripts\probar-correo.mjs "%CORREO%"
echo.
pause
