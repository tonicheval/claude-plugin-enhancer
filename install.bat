@echo off
title Claude Plugin Enhancer Installer
rem Optional argument: rollout stage A, B or C (default C = all patches). See README.
if not "%~1"=="" set ENHANCER_STAGE=%~1
echo Running Claude Plugin Enhancer Installation...
node "%~dp0install.js"
pause
