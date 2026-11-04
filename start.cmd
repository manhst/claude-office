@echo off
setlocal
cd /d "%~dp0"
rem Usage: start.cmd "task"        (real Claude agents)
rem        start.cmd mock "task"   (mock agents, no API calls)
set MOCK=
if /i "%~1"=="mock" (set MOCK=--mock& shift)
set TASK=%~1
if "%TASK%"=="" set /p TASK=Task: 
if not exist orchestrator\node_modules (pushd orchestrator & call npm install & popd)
if not exist web\node_modules (pushd web & call npm install & popd)
if not exist web\dist\index.html (pushd web & call npm run build & popd)
if exist orchestrator\.run\ui-url.txt del orchestrator\.run\ui-url.txt
start "" /b powershell -NoProfile -Command "$f='orchestrator\.run\ui-url.txt'; for($i=0;$i -lt 60;$i++){ if(Test-Path $f){ Start-Process (Get-Content $f -TotalCount 1); break }; Start-Sleep 1 }"
call npx --prefix orchestrator tsx orchestrator\src\cli.ts start %MOCK% --office --keep-alive "%TASK%"
