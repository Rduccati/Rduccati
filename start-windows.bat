@echo off
chcp 65001 >nul
title WATCH POS
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua cai Node.js. Tai ban LTS tai https://nodejs.org roi chay lai file nay.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Dang cai dat thu vien lan dau, vui long cho...
  call npm install
)
if not exist dist (
  echo Dang build giao dien...
  call npm run build
)
echo.
echo  WATCH POS dang khoi dong. Mo trinh duyet: http://localhost:3000
echo  (Giu cua so nay mo trong khi su dung. Dong cua so = tat phan mem)
echo.
start "" http://localhost:3000
call npm start
pause
