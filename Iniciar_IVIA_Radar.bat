@echo off
title IVIA Lead Radar - Ingversia
cd /d "%~dp0"
echo ==============================================================
echo   Iniciando IVIA Lead Radar en http://localhost:3000 ...
echo   (No cierres esta ventana mientras uses el Dashboard)
echo ==============================================================
start "" "http://localhost:3000"
node src/server.js
pause
