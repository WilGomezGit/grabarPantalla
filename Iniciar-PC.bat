@echo off
cd /d "%~dp0desktop"
if not exist node_modules (call npm install && node node_modules\electron\install.js)
start "" node_modules\electron\dist\electron.exe .
