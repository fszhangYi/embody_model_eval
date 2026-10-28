@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title embody_model_eval dry-run :6006
call "%~dp0..\scripts\env_python.bat" || goto :fail

REM Simulation / no-login (no hardware mode for this host)
set "EMBODY_AUTH_DISABLED=1"

echo [embody] dry-run  http://127.0.0.1:6006/
"%PYTHON%" scripts\agent_server.py 6006 --bind 127.0.0.1
set "ERR=%ERRORLEVEL%"
goto :end

:fail
set "ERR=1"
:end
echo.
echo Exit code %ERR%. Press any key to close.
pause >nul
exit /b %ERR%
