@echo off
chcp 65001 >nul
title Sistema de boletería TAVA teatro
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo No se encontró Node.js. Instálalo desde https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Instalando dependencias ^(npm install^)...
    call npm install
    if errorlevel 1 (
        echo Falló npm install.
        pause
        exit /b 1
    )
)

echo Iniciando servidor...
echo Abre el navegador en: http://localhost:3000
echo Cierra esta ventana para detener el servidor.
echo.
call npm start
echo.
pause
