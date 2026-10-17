@echo off
cd /d "%~dp0desktop"
call npm run build
echo Listo: revisa la carpeta desktop\dist
pause
