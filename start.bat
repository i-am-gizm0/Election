@echo off
title Election API
:loop
call npm start
if %ErrorLevel% NEQ 1 goto loop
timeout /t -1