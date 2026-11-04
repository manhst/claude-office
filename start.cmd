@echo off
setlocal
cd /d "%~dp0"
git pull --ff-only || echo [office] WARNING: git pull failed, continuing with the local copy.
cls
rem Usage: start.cmd         (live: shows Claude Code sessions reported by the "office" mod)
rem        start.cmd demo    (3 simulated sessions, no Claude needed)
set DEMO=
if /i "%~1"=="demo" set DEMO=--demo
if /i "%~1"=="mock" set DEMO=--demo
node scripts\install-mod.mjs || echo [office] WARNING: mod install failed.
if not exist orchestrator\node_modules (pushd orchestrator & call npm install & popd)
if not exist web\node_modules (pushd web & call npm install & popd)
pushd web & call npm run build & popd
if exist orchestrator\.run\ui-url.txt del orchestrator\.run\ui-url.txt
start "" /b powershell -NoProfile -Command "$f='orchestrator\.run\ui-url.txt'; for($i=0;$i -lt 60;$i++){ if(Test-Path $f){ Start-Process (Get-Content $f -TotalCount 1); break }; Start-Sleep 1 }"
call npx --prefix orchestrator tsx orchestrator\src\cli.ts start %DEMO%
