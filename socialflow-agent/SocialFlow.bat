@echo off
chcp 65001 >nul 2>&1
title SocialFlow Agent
cd /d "%~dp0"

:: Use local node if available, otherwise system node
set "NODE=node"
set "NPM=npm"
set "NPX=npx"
if exist "node\node.exe" (
    set "NODE=%~dp0node\node.exe"
    set "NPM=%~dp0node\npm.cmd"
    set "NPX=%~dp0node\npx.cmd"
    set "PATH=%~dp0node;%PATH%"
)

:: Check Node.js (local or system)
"%NODE%" --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ========================================
    echo   Cai dat Node.js tu dong...
    echo ========================================
    echo.

    :: Download Node.js portable
    echo [1/1] Dang tai Node.js...
    powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $url = 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip'; $out = 'node-portable.zip'; (New-Object Net.WebClient).DownloadFile($url, $out); Write-Host '[OK] Da tai Node.js' }"

    if not exist "node-portable.zip" (
        echo [!] Khong the tai Node.js. Vui long kiem tra ket noi mang.
        pause
        exit /b
    )

    echo [2/2] Giai nen...
    powershell -Command "Expand-Archive -Path 'node-portable.zip' -DestinationPath '.' -Force"
    if exist "node-v22.14.0-win-x64" (
        ren "node-v22.14.0-win-x64" "node"
    )
    del "node-portable.zip" 2>nul

    :: Update paths
    set "NODE=%~dp0node\node.exe"
    set "NPM=%~dp0node\npm.cmd"
    set "NPX=%~dp0node\npx.cmd"
    set "PATH=%~dp0node;%PATH%"

    echo [OK] Node.js da duoc cai dat!
    echo.
)

:: Auto setup on first run
if not exist "node_modules" (
    echo ========================================
    echo   Cai dat lan dau - vui long doi...
    echo ========================================
    echo.
    echo [1/2] Cai dat dependencies...
    call "%NPM%" install --production 2>nul
    echo.
    echo [2/2] Cai dat trinh duyet (co the mat vai phut)...
    call "%NPX%" playwright install chromium 2>nul
    echo.
    echo [OK] Cai dat hoan tat!
    echo ========================================
    echo.
)

:: Check .env exists
if not exist ".env" (
    echo [!] Khong tim thay file .env
    echo     Tai lai agent tu trang Cai dat de co file cau hinh.
    echo.
    pause
    exit /b
)

:: Start agent
echo ========================================
echo   SocialFlow Agent - Dang chay...
echo   Nhan Ctrl+C de dung
echo ========================================
echo.
"%NODE%" agent.js
if %errorlevel% neq 0 (
    echo.
    echo [!] Agent da dung do loi. Xem thong bao o tren.
)
pause
