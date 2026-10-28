@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title embody_model_eval run :6006
call "%~dp0..\scripts\env_python.bat" || goto :fail

REM Login required (password: see 启动与密码.txt / console)
set "EMBODY_AUTH_DISABLED="

echo [embody] run  http://127.0.0.1:6006/
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
