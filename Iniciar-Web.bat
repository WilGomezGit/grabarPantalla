@echo off
cd /d "%~dp0web"
echo WAG Rec web en http://localhost:8080  (Ctrl+C para cerrar)
start http://localhost:8080
npx -y http-server -p 8080 -c-1
