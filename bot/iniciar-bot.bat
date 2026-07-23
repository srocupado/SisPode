@echo off
chcp 65001 >nul
REM Sobe o SisPode Bot em LOOP: se o processo encerrar (crash ou /update),
REM ele volta sozinho com o codigo novo. Rode ESTE arquivo em vez de
REM "node index.js". Para sair de vez: feche a janela ou Ctrl+C duas vezes.
cd /d "%~dp0"
:loop
echo(
echo ==========================================================
echo [%date% %time%] Subindo o SisPode Bot...
echo ==========================================================
node index.js
echo(
echo [%date% %time%] Bot encerrou (codigo %errorlevel%). Reiniciando em 3s...
echo (feche a janela ou Ctrl+C agora para NAO reiniciar)
timeout /t 3 >nul
goto loop
