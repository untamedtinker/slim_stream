@echo off
REM ==============================================================================
REM SlimStream - One-Command Startup Script (Windows)
REM ==============================================================================

echo ========================================================
echo           Starting SlimStream Video Dashboard           
echo ========================================================

REM 1. Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [Error] Node.js is not installed. Please install Node.js (v18+) from https://nodejs.org/
    pause
    exit /b 1
)

REM 2. Check for FFmpeg and auto-install if winget exists
where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
    echo FFmpeg was not found. Attempting automatic installation via winget...
    where winget >nul 2>nul
    if %errorlevel% equ 0 (
        echo Installing FFmpeg via Windows Package Manager...
        winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
    )
)

REM 3. Install NPM dependencies if node_modules does not exist
if not exist "node_modules\" (
    echo Installing required project dependencies...
    call npm install
)

echo Starting SlimStream local server on http://localhost:3000...
call npm start
pause
