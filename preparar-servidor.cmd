@echo off
rem AutoMarket 3D - arma la carpeta para-el-servidor con lo que hay que subir al servidor:
rem   automarket.tar.gz  el proyecto (sin node_modules, compilaciones, claves ni fotos)
rem   respaldo.sql.gz    una copia nueva de la base (MySQL de XAMPP tiene que estar encendido)
rem   fotos.tar.gz       las fotos, videos y documentos de apps\api\.dev-s3
rem Luego sigue deploy\GUIA.md.
cd /d "%~dp0"
set "OUT=%~dp0para-el-servidor"
if not exist "%OUT%" mkdir "%OUT%"
echo.
echo 1/3  Copia nueva de la base...
node scripts\respaldar-base.mjs || goto fallo
for /f "delims=" %%F in ('dir /b /o-d "respaldos\automarket-*.sql.gz"') do (
  copy /y "respaldos\%%F" "%OUT%\respaldo.sql.gz" >nul
  goto copiado
)
:copiado
echo.
echo 2/3  Empaquetando el proyecto (1 o 2 minutos)...
tar -czf "%OUT%\automarket.tar.gz" -C "%~dp0.." --exclude=node_modules --exclude=.next --exclude=dist --exclude=.dev-s3 --exclude=.dev-db --exclude=respaldos --exclude=para-el-servidor --exclude=copias-del-proyecto --exclude=parches-respaldo --exclude=generated --exclude=.git --exclude=.env --exclude=.env.* --exclude=*.log --exclude=*.exe --exclude=*.tsbuildinfo automarket-3d || goto fallo
echo.
echo 3/3  Empaquetando las fotos...
if exist "apps\api\.dev-s3" (
  tar -czf "%OUT%\fotos.tar.gz" -C "apps\api" .dev-s3 || goto fallo
) else (
  echo No hay fotos en apps\api\.dev-s3. Se sigue sin ellas.
)
echo.
echo Listo. Sube al servidor los archivos de la carpeta para-el-servidor:
dir /b "%OUT%"
echo.
echo El paso a paso esta en deploy\GUIA.md.
pause
exit /b 0

:fallo
echo.
echo Algo fallo (mira el mensaje de arriba). No se subio nada a ningun lado.
pause
exit /b 1
