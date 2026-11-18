@echo off
title Velara CRM - DEMOSTRACION
cd /d "%~dp0server"

if not exist node_modules (
  echo Instalando dependencias por primera vez, espera un momento...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

rem Base aparte (server\data-demo): nunca toca los datos reales.
set NOVA_DATA_DIR=data-demo
set NOVA_DISABLE_AUTH=true
set PORT=4011

if not exist data-demo\nova_crm.db (
  echo Creando la demo con 7 meses de clientes, trabajos y finanzas...
  node scripts\seed-demo.js
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo.
echo DEMO de Velara CRM en http://localhost:4011  (datos inventados, sin login)
echo Para generarla de nuevo, cierra esta ventana y borra la carpeta server\data-demo.
echo.
start "" http://localhost:4011
node index.js
pause
