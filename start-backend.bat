@echo off
chcp 65001 >nul
set PATH=C:\Users\Administrator\node-portable\node-v20.18.0-win-x64;%PATH%
cd /d "C:\Users\Administrator\Desktop\助理项目\助理项目\APP-AIE\backend"
node --import tsx src/index.ts
pause
