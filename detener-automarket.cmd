@echo off
rem AutoMarket 3D - cierra lo que haya quedado abierto de AutoMarket: la web (3000),
rem la API (4000) y las imagenes (9000). Solo toca los programas que usan esos puertos.
rem Sirve cuando cerraste la ventana pero la pagina sigue respondiendo con la version vieja.
echo.
echo Cerrando AutoMarket (puertos 3000, 4000 y 9000)...
for %%P in (3000 4000 9000) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do taskkill /PID %%I /T /F >nul 2>&1
)
timeout /t 2 /nobreak >nul
set "QUEDA="
for %%P in (3000 4000 9000) do (
  netstat -ano | findstr /R /C:":%%P .*LISTENING" >nul && (
    set "QUEDA=1"
    echo Sigue abierto el puerto %%P.
  )
)
if defined QUEDA (
  echo Algo no se pudo cerrar. Abre el Administrador de tareas y finaliza "Node.js JavaScript Runtime".
) else (
  echo Listo: AutoMarket quedo cerrado. Ya puedes abrir AutoMarket.exe otra vez.
)
echo.
pause
