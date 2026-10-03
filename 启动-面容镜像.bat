@echo off
rem ============================================================
rem  Face Feature Mirror - local static server launcher
rem  NOTE: this file MUST stay ASCII-only and CRLF-terminated.
rem  A UTF-8 / bare-LF batch file breaks cmd.exe parsing
rem  (parenthesised blocks in particular) and the window just
rem  flashes and disappears.  Chinese output is printed by
rem  serve.mjs instead, which is safe.
rem ============================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Face Feature Mirror - local server (close this window to stop)

set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "D:\node\node.exe" set "NODE=D:\node\node.exe"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE goto nonode

echo.
echo   Starting local server ... (keep this window open)
echo.
"%NODE%" serve.mjs %*
set "RC=%ERRORLEVEL%"
echo.
echo   Server stopped (exit code %RC%).
pause
exit /b %RC%

:nonode
echo.
echo   Node.js was not found on this machine.
echo   Either install Node.js, or run this manually:
echo.
echo       python -m http.server 8777 --bind 127.0.0.1
echo.
echo   then open  http://127.0.0.1:8777/index.html
echo.
pause
exit /b 1
