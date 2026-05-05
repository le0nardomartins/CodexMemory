@echo off

setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

chcp 65001 >nul



set "DEFAULT_OLLAMA_MODEL=qwen2.5:3b"

set "ROOT=%cd%"

set "HAS_PWSH=0"

where powershell >nul 2>nul && set "HAS_PWSH=1"

title CodexMemory Control Center



:menu

cls

call :line

call :cecho 96 "  CodexMemory - Control Center"

call :line

call :cecho 93 "  [1] Setup completo e iniciar Desktop"

call :cecho 93 "  [2] Reiniciar GUI Desktop (Electron)"

call :cecho 93 "  [3] Reiniciar Ollama"

call :cecho 93 "  [4] Forcar novo AGENT_MEMORY"

call :cecho 93 "  [5] Mostrar status rapido"

call :cecho 93 "  [6] Encerrar tudo (GUI + Node + Ollama)"

call :cecho 93 "  [7] Iniciar apenas GUI web (node --mode gui)"

call :cecho 91 "  [0] Sair"

call :line

set "OPT="

set /p OPT="Escolha uma opcao: "



if "%OPT%"=="1" call :setup_and_start & goto post

if "%OPT%"=="2" call :restart_gui & goto post

if "%OPT%"=="3" call :restart_ollama & goto post

if "%OPT%"=="4" call :force_memory & goto post

if "%OPT%"=="5" call :show_status & goto post

if "%OPT%"=="6" call :stop_all & goto post

if "%OPT%"=="7" call :start_web_gui & goto post

if "%OPT%"=="0" goto end



call :cecho 91 "Opcao invalida."

goto post



:post

echo.

call :cecho 95 "Pressione qualquer tecla para voltar ao menu..."

pause >nul

goto menu



:setup_and_start

call :line

call :cecho 96 "[SETUP] Validando ambiente..."

call :ensure_node || exit /b 1

call :ensure_npm || exit /b 1

call :ensure_dependencies || exit /b 1

call :ensure_ollama || exit /b 1

call :ensure_model || exit /b 1

call :start_desktop

exit /b 0



:restart_gui

call :line

call :cecho 96 "[GUI] Reiniciando Desktop..."

call :ensure_node || exit /b 1

call :ensure_npm || exit /b 1

call :stop_gui

call :start_desktop

exit /b 0



:restart_ollama

call :line

call :cecho 96 "[OLLAMA] Reiniciando servico..."

call :ensure_ollama_cli || exit /b 1

taskkill /F /T /IM "ollama.exe" >nul 2>nul

taskkill /F /T /IM "Ollama.exe" >nul 2>nul

timeout /t 1 /nobreak >nul

call :ensure_ollama || exit /b 1

call :ensure_model || exit /b 1

call :cecho 92 "[OK] Ollama reiniciado."

exit /b 0



:force_memory

call :line

call :cecho 96 "[SYNC] Forcando novo AGENT_MEMORY.md..."

call :ensure_node || exit /b 1

call :ensure_ollama || exit /b 1

set "OLLAMA_MODEL=%DEFAULT_OLLAMA_MODEL%"

node server.js --mode daemon --once

if errorlevel 1 (

  call :cecho 91 "[ERRO] Falha ao forcar AGENT_MEMORY."

  exit /b 1

)

call :cecho 92 "[OK] AGENT_MEMORY forçado com sucesso."

exit /b 0



:show_status

call :line

call :cecho 96 "[STATUS] Processos e servicos"

tasklist /FI "IMAGENAME eq electron.exe" | find /I "electron.exe" >nul && (

  call :cecho 92 " - Electron: rodando"

) || (

  call :cecho 93 " - Electron: parado"

)

tasklist /FI "IMAGENAME eq ollama.exe" | find /I "ollama.exe" >nul && (

  call :cecho 92 " - Ollama: rodando"

) || (

  call :cecho 93 " - Ollama: parado"

)

if exist "memory_voult\AGENT_MEMORY.md" (

  for %%I in ("memory_voult\AGENT_MEMORY.md") do call :cecho 92 " - AGENT_MEMORY.md: atualizado em %%~tI"

) else (

  call :cecho 91 " - AGENT_MEMORY.md: ausente"

)

exit /b 0



:stop_all

call :line

call :cecho 96 "[STOP] Encerrando GUI, Node e Ollama..."

call :stop_gui

taskkill /F /T /IM "ollama.exe" >nul 2>nul

taskkill /F /T /IM "Ollama.exe" >nul 2>nul

call :cecho 92 "[OK] Encerramento concluido."

exit /b 0



:start_web_gui

call :line

call :cecho 96 "[GUI-WEB] Iniciando node --mode gui..."

call :ensure_node || exit /b 1

cd /d "%ROOT%"
call :cecho 93 "[INFO] GUI web rodando nesta janela. Use Ctrl+C para parar."
node server.js --mode gui

if errorlevel 1 (
  call :cecho 91 "[ERRO] GUI web finalizou com erro."
  exit /b 1
)
call :cecho 92 "[OK] GUI web finalizada."

exit /b 0



:start_desktop

call :cecho 96 "[GUI] Iniciando app desktop..."

set "OLLAMA_MODEL=%DEFAULT_OLLAMA_MODEL%"

cd /d "%ROOT%"
call :cecho 93 "[INFO] Desktop rodando nesta janela. Aguarde o encerramento do app."
call npm run desktop

if errorlevel 1 (
  call :cecho 91 "[ERRO] Desktop finalizou com erro."
  exit /b 1
)
call :cecho 92 "[OK] Desktop finalizado."

exit /b 0



:stop_gui

taskkill /F /T /IM "electron.exe" >nul 2>nul

taskkill /F /T /IM "CodexMemory.exe" >nul 2>nul

for /f %%A in ('

  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $p = Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'node.exe' -and $_.CommandLine -match 'CodexMemory' -and $_.CommandLine -match 'server.js' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } }"

') do rem

call :cecho 92 "[OK] Processos da GUI encerrados."

exit /b 0



:ensure_node

where node >nul 2>nul

if errorlevel 1 (

  call :cecho 91 "[ERRO] Node.js nao encontrado no PATH."

  exit /b 1

)

exit /b 0



:ensure_npm

where npm >nul 2>nul

if errorlevel 1 (

  call :cecho 91 "[ERRO] npm nao encontrado no PATH."

  exit /b 1

)

exit /b 0



:ensure_ollama_cli

where ollama >nul 2>nul

if errorlevel 1 (

  call :cecho 91 "[ERRO] Ollama nao encontrado no PATH. Instale em https://ollama.com/download"

  exit /b 1

)

exit /b 0



:ensure_dependencies

if exist "node_modules" (

  call :cecho 92 "[OK] node_modules encontrado."

  exit /b 0

)

call :cecho 93 "[INFO] Instalando dependencias com npm install..."

call npm install

if errorlevel 1 (

  call :cecho 91 "[ERRO] Falha ao instalar dependencias."

  exit /b 1

)

call :cecho 92 "[OK] Dependencias instaladas."

exit /b 0



:ensure_ollama

call :ensure_ollama_cli || exit /b 1

ollama list >nul 2>nul

if not errorlevel 1 (

  call :cecho 92 "[OK] Ollama acessivel."

  exit /b 0

)

call :cecho 93 "[INFO] Iniciando Ollama..."

start "" /B ollama serve >nul 2>nul

set "TRY=0"

:wait_ollama

set /a TRY+=1

timeout /t 1 /nobreak >nul

ollama list >nul 2>nul

if not errorlevel 1 (

  call :cecho 92 "[OK] Ollama iniciou com sucesso."

  exit /b 0

)

if !TRY! GEQ 25 (

  call :cecho 91 "[ERRO] Nao foi possivel iniciar o Ollama."

  exit /b 1

)

goto wait_ollama



:ensure_model

call :cecho 96 "[MODEL] Garantindo modelo %DEFAULT_OLLAMA_MODEL%..."

ollama list | findstr /I /C:"%DEFAULT_OLLAMA_MODEL%" >nul

if not errorlevel 1 (

  call :cecho 92 "[OK] Modelo ja instalado."

  exit /b 0

)

call :cecho 93 "[INFO] Baixando modelo %DEFAULT_OLLAMA_MODEL%..."

ollama pull "%DEFAULT_OLLAMA_MODEL%"

if errorlevel 1 (

  call :cecho 91 "[ERRO] Falha ao baixar modelo %DEFAULT_OLLAMA_MODEL%."

  exit /b 1

)

call :cecho 92 "[OK] Modelo instalado."

exit /b 0



:line

echo ============================================================

exit /b 0



:cecho

set "C=%~1"

set "MSG=%~2"

if "%MSG%"=="" (

  echo.

  exit /b 0

)

set "FC=White"

if "%C%"=="91" set "FC=Red"

if "%C%"=="92" set "FC=Green"

if "%C%"=="93" set "FC=Yellow"

if "%C%"=="95" set "FC=Magenta"

if "%C%"=="96" set "FC=Cyan"

if "%HAS_PWSH%"=="1" (

  set "CMSG=%MSG%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Write-Host $env:CMSG -ForegroundColor %FC%"

) else (

  echo %MSG%

)

exit /b 0



:end

endlocal

exit /b 0

