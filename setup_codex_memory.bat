@echo off

setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

chcp 65001 >nul



set "DEFAULT_OLLAMA_MODEL=qwen2.5:3b"

set "ROOT=%cd%"

set "HAS_PWSH=0"

set "LOCALE=en-US"

echo [BOOT] Detecting system language...
where powershell >nul 2>nul && set "HAS_PWSH=1"

if "%HAS_PWSH%"=="1" (

  for /f "usebackq delims=" %%L in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.Globalization.CultureInfo]::InstalledUICulture.Name"`) do set "LOCALE=%%L"

)

echo [BOOT] Selected language: %LOCALE%
echo [BOOT] Loading translated menu...
echo.



call :load_texts

title %TXT_TITLE%



:menu

cls

call :line

call :cecho 96 "  %TXT_TITLE%"

call :line

call :cecho 93 "  [1] %TXT_MENU_1%"

call :cecho 93 "  [2] %TXT_MENU_2%"

call :cecho 93 "  [3] %TXT_MENU_3%"

call :cecho 93 "  [4] %TXT_MENU_4%"

call :cecho 93 "  [5] %TXT_MENU_5%"

call :cecho 93 "  [6] %TXT_MENU_6%"

call :cecho 93 "  [7] %TXT_MENU_7%"

call :cecho 91 "  [0] %TXT_MENU_0%"

call :line

set "OPT="

set /p OPT="%TXT_PROMPT_OPTION% "



if "%OPT%"=="1" call :setup_and_start & goto post

if "%OPT%"=="2" call :restart_gui & goto post

if "%OPT%"=="3" call :restart_ollama & goto post

if "%OPT%"=="4" call :force_memory & goto post

if "%OPT%"=="5" call :show_status & goto post

if "%OPT%"=="6" call :stop_all & goto post

if "%OPT%"=="7" call :start_web_gui & goto post

if "%OPT%"=="0" goto end



call :cecho 91 "%TXT_INVALID_OPTION%"

goto post



:post

echo.

call :cecho 95 "%TXT_BACK_MENU%"

pause >nul

goto menu



:setup_and_start

call :line

call :cecho 96 "%TXT_SETUP_CHECK%"

call :ensure_node || exit /b 1

call :ensure_npm || exit /b 1

call :ensure_dependencies || exit /b 1

call :ensure_ollama || exit /b 1

call :ensure_model || exit /b 1

call :start_desktop

exit /b 0



:restart_gui

call :line

call :cecho 96 "%TXT_GUI_RESTART%"

call :ensure_node || exit /b 1

call :ensure_npm || exit /b 1

call :stop_gui

call :start_desktop

exit /b 0



:restart_ollama

call :line

call :cecho 96 "%TXT_OLLAMA_RESTART%"

call :ensure_ollama_cli || exit /b 1

taskkill /F /T /IM "ollama.exe" >nul 2>nul

taskkill /F /T /IM "Ollama.exe" >nul 2>nul

timeout /t 1 /nobreak >nul

call :ensure_ollama || exit /b 1

call :ensure_model || exit /b 1

call :cecho 92 "%TXT_OLLAMA_RESTART_OK%"

exit /b 0



:force_memory

call :line

call :cecho 96 "%TXT_FORCE_MEMORY%"

call :ensure_node || exit /b 1

call :ensure_ollama || exit /b 1

set "OLLAMA_MODEL=%DEFAULT_OLLAMA_MODEL%"

node server.js --mode daemon --once

if errorlevel 1 (

  call :cecho 91 "%TXT_FORCE_MEMORY_FAIL%"

  exit /b 1

)

call :cecho 92 "%TXT_FORCE_MEMORY_OK%"

exit /b 0



:show_status

call :line

call :cecho 96 "%TXT_STATUS_TITLE%"

tasklist /FI "IMAGENAME eq electron.exe" | find /I "electron.exe" >nul && (

  call :cecho 92 " - %TXT_STATUS_ELECTRON_ON%"

) || (

  call :cecho 93 " - %TXT_STATUS_ELECTRON_OFF%"

)

tasklist /FI "IMAGENAME eq ollama.exe" | find /I "ollama.exe" >nul && (

  call :cecho 92 " - %TXT_STATUS_OLLAMA_ON%"

) || (

  call :cecho 93 " - %TXT_STATUS_OLLAMA_OFF%"

)

if exist "memory_voult\AGENT_MEMORY.md" (

  for %%I in ("memory_voult\AGENT_MEMORY.md") do call :cecho 92 " - %TXT_STATUS_MEMORY_ON% %%~tI"

) else (

  call :cecho 91 " - %TXT_STATUS_MEMORY_OFF%"

)

exit /b 0



:stop_all

call :line

call :cecho 96 "%TXT_STOP_ALL%"

call :stop_gui

taskkill /F /T /IM "ollama.exe" >nul 2>nul

taskkill /F /T /IM "Ollama.exe" >nul 2>nul

call :cecho 92 "%TXT_STOP_ALL_OK%"

exit /b 0



:start_web_gui

call :line

call :cecho 96 "%TXT_GUI_WEB_START%"

call :ensure_node || exit /b 1

cd /d "%ROOT%"

call :cecho 93 "%TXT_GUI_WEB_RUNNING%"

node server.js --mode gui

if errorlevel 1 (

  call :cecho 91 "%TXT_GUI_WEB_FAIL%"

  exit /b 1

)

call :cecho 92 "%TXT_GUI_WEB_OK%"

exit /b 0



:start_desktop

call :cecho 96 "%TXT_DESKTOP_START%"

set "OLLAMA_MODEL=%DEFAULT_OLLAMA_MODEL%"

cd /d "%ROOT%"

call :cecho 93 "%TXT_DESKTOP_RUNNING%"

call npm run desktop

if errorlevel 1 (

  call :cecho 91 "%TXT_DESKTOP_FAIL%"

  exit /b 1

)

call :cecho 92 "%TXT_DESKTOP_OK%"

exit /b 0



:stop_gui

taskkill /F /T /IM "electron.exe" >nul 2>nul

taskkill /F /T /IM "CodexMemory.exe" >nul 2>nul

for /f %%A in ('

  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $p = Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'node.exe' -and $_.CommandLine -match 'CodexMemory' -and $_.CommandLine -match 'server.js' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } }"

') do rem

call :cecho 92 "%TXT_GUI_STOP_OK%"

exit /b 0



:ensure_node

where node >nul 2>nul

if errorlevel 1 (

  call :cecho 91 "%TXT_NODE_MISSING%"

  call :cecho 93 "%TXT_NODE_INSTALL%"

  exit /b 1

)

exit /b 0



:ensure_npm

where npm >nul 2>nul

if errorlevel 1 (

  call :cecho 91 "%TXT_NPM_MISSING%"

  call :cecho 93 "%TXT_NODE_INSTALL%"

  exit /b 1

)

exit /b 0



:ensure_ollama_cli

where ollama >nul 2>nul

if errorlevel 1 (

  call :cecho 91 "%TXT_OLLAMA_MISSING%"

  call :cecho 93 "%TXT_OLLAMA_INSTALL%"

  exit /b 1

)

exit /b 0



:ensure_dependencies

if exist "node_modules" (

  call :cecho 92 "%TXT_DEPS_OK%"

  exit /b 0

)

call :cecho 93 "%TXT_DEPS_INSTALLING%"

call npm install

if errorlevel 1 (

  call :cecho 91 "%TXT_DEPS_FAIL%"

  call :cecho 93 "%TXT_DEPS_HINT%"

  exit /b 1

)

call :cecho 92 "%TXT_DEPS_DONE%"

exit /b 0



:ensure_ollama

call :ensure_ollama_cli || exit /b 1

ollama list >nul 2>nul

if not errorlevel 1 (

  call :cecho 92 "%TXT_OLLAMA_OK%"

  exit /b 0

)

call :cecho 93 "%TXT_OLLAMA_STARTING%"

start "" /B ollama serve >nul 2>nul

set "TRY=0"

:wait_ollama

set /a TRY+=1

timeout /t 1 /nobreak >nul

ollama list >nul 2>nul

if not errorlevel 1 (

  call :cecho 92 "%TXT_OLLAMA_STARTED%"

  exit /b 0

)

if !TRY! GEQ 25 (

  call :cecho 91 "%TXT_OLLAMA_START_FAIL%"

  call :cecho 93 "%TXT_OLLAMA_INSTALL%"

  exit /b 1

)

goto wait_ollama



:ensure_model

call :cecho 96 "%TXT_MODEL_CHECK% %DEFAULT_OLLAMA_MODEL%..."

ollama list | findstr /I /C:"%DEFAULT_OLLAMA_MODEL%" >nul

if not errorlevel 1 (

  call :cecho 92 "%TXT_MODEL_OK%"

  exit /b 0

)

call :cecho 93 "%TXT_MODEL_PULL% %DEFAULT_OLLAMA_MODEL%..."

ollama pull "%DEFAULT_OLLAMA_MODEL%"

if errorlevel 1 (

  call :cecho 91 "%TXT_MODEL_FAIL% %DEFAULT_OLLAMA_MODEL%."

  exit /b 1

)

call :cecho 92 "%TXT_MODEL_DONE%"

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



:load_texts

set "LANG_KEY=en"

echo %LOCALE% | findstr /I "^pt" >nul && set "LANG_KEY=pt"

echo %LOCALE% | findstr /I "^es" >nul && set "LANG_KEY=es"



if "%LANG_KEY%"=="pt" goto texts_pt

if "%LANG_KEY%"=="es" goto texts_es

goto texts_en



:texts_pt

set "TXT_TITLE=CodexMemory - Central de Controle"

set "TXT_MENU_1=Setup completo e iniciar Desktop"

set "TXT_MENU_2=Reiniciar GUI Desktop (Electron)"

set "TXT_MENU_3=Reiniciar Ollama"

set "TXT_MENU_4=Forcar novo AGENT_MEMORY"

set "TXT_MENU_5=Mostrar status rapido"

set "TXT_MENU_6=Encerrar tudo (GUI + Node + Ollama)"

set "TXT_MENU_7=Iniciar apenas GUI web (node --mode gui)"

set "TXT_MENU_0=Sair"

set "TXT_PROMPT_OPTION=Escolha uma opcao:"

set "TXT_INVALID_OPTION=Opcao invalida."

set "TXT_BACK_MENU=Pressione qualquer tecla para voltar ao menu..."

set "TXT_SETUP_CHECK=[SETUP] Validando ambiente..."

set "TXT_GUI_RESTART=[GUI] Reiniciando Desktop..."

set "TXT_OLLAMA_RESTART=[OLLAMA] Reiniciando servico..."

set "TXT_OLLAMA_RESTART_OK=[OK] Ollama reiniciado."

set "TXT_FORCE_MEMORY=[SYNC] Forcando novo AGENT_MEMORY.md..."

set "TXT_FORCE_MEMORY_OK=[OK] AGENT_MEMORY recriado com sucesso."

set "TXT_FORCE_MEMORY_FAIL=[ERRO] Falha ao forcar AGENT_MEMORY."

set "TXT_STATUS_TITLE=[STATUS] Processos e servicos"

set "TXT_STATUS_ELECTRON_ON=Electron: rodando"

set "TXT_STATUS_ELECTRON_OFF=Electron: parado"

set "TXT_STATUS_OLLAMA_ON=Ollama: rodando"

set "TXT_STATUS_OLLAMA_OFF=Ollama: parado"

set "TXT_STATUS_MEMORY_ON=AGENT_MEMORY.md: atualizado em"

set "TXT_STATUS_MEMORY_OFF=AGENT_MEMORY.md: ausente"

set "TXT_STOP_ALL=[STOP] Encerrando GUI, Node e Ollama..."

set "TXT_STOP_ALL_OK=[OK] Encerramento concluido."

set "TXT_GUI_WEB_START=[GUI-WEB] Iniciando node --mode gui..."

set "TXT_GUI_WEB_RUNNING=[INFO] GUI web rodando nesta janela. Use Ctrl+C para parar. Aguarde cerca de 10 segundos para iniciar."

set "TXT_GUI_WEB_FAIL=[ERRO] GUI web finalizou com erro."

set "TXT_GUI_WEB_OK=[OK] GUI web finalizada."

set "TXT_DESKTOP_START=[GUI] Iniciando app desktop..."

set "TXT_DESKTOP_RUNNING=[INFO] Desktop rodando nesta janela. A inicializacao pode levar cerca de 10 segundos."

set "TXT_DESKTOP_FAIL=[ERRO] Desktop finalizou com erro."

set "TXT_DESKTOP_OK=[OK] Desktop finalizado."

set "TXT_GUI_STOP_OK=[OK] Processos da GUI encerrados."

set "TXT_NODE_MISSING=[ERRO] Node.js nao encontrado no PATH."

set "TXT_NPM_MISSING=[ERRO] npm nao encontrado no PATH."

set "TXT_NODE_INSTALL=[AJUDA] Baixe e instale Node.js 18+: https://nodejs.org"

set "TXT_OLLAMA_MISSING=[ERRO] Ollama nao encontrado no PATH."

set "TXT_OLLAMA_INSTALL=[AJUDA] Baixe e instale Ollama: https://ollama.com/download"

set "TXT_DEPS_OK=[OK] node_modules encontrado."

set "TXT_DEPS_INSTALLING=[INFO] Instalando dependencias com npm install..."

set "TXT_DEPS_FAIL=[ERRO] Falha ao instalar dependencias."

set "TXT_DEPS_HINT=[AJUDA] Verifique internet/permissoes e tente novamente."

set "TXT_DEPS_DONE=[OK] Dependencias instaladas."

set "TXT_OLLAMA_OK=[OK] Ollama acessivel."

set "TXT_OLLAMA_STARTING=[INFO] Iniciando Ollama..."

set "TXT_OLLAMA_STARTED=[OK] Ollama iniciou com sucesso."

set "TXT_OLLAMA_START_FAIL=[ERRO] Nao foi possivel iniciar o Ollama."

set "TXT_MODEL_CHECK=[MODEL] Garantindo modelo"

set "TXT_MODEL_OK=[OK] Modelo ja instalado."

set "TXT_MODEL_PULL=[INFO] Baixando modelo"

set "TXT_MODEL_FAIL=[ERRO] Falha ao baixar modelo"

set "TXT_MODEL_DONE=[OK] Modelo instalado."

exit /b 0



:texts_es

set "TXT_TITLE=CodexMemory - Centro de Control"

set "TXT_MENU_1=Setup completo e iniciar Desktop"

set "TXT_MENU_2=Reiniciar GUI Desktop (Electron)"

set "TXT_MENU_3=Reiniciar Ollama"

set "TXT_MENU_4=Forzar nuevo AGENT_MEMORY"

set "TXT_MENU_5=Mostrar estado rapido"

set "TXT_MENU_6=Cerrar todo (GUI + Node + Ollama)"

set "TXT_MENU_7=Iniciar solo GUI web (node --mode gui)"

set "TXT_MENU_0=Salir"

set "TXT_PROMPT_OPTION=Elige una opcion:"

set "TXT_INVALID_OPTION=Opcion invalida."

set "TXT_BACK_MENU=Presiona una tecla para volver al menu..."

set "TXT_SETUP_CHECK=[SETUP] Validando entorno..."

set "TXT_GUI_RESTART=[GUI] Reiniciando Desktop..."

set "TXT_OLLAMA_RESTART=[OLLAMA] Reiniciando servicio..."

set "TXT_OLLAMA_RESTART_OK=[OK] Ollama reiniciado."

set "TXT_FORCE_MEMORY=[SYNC] Forzando nuevo AGENT_MEMORY.md..."

set "TXT_FORCE_MEMORY_OK=[OK] AGENT_MEMORY recreado con exito."

set "TXT_FORCE_MEMORY_FAIL=[ERROR] Fallo al forzar AGENT_MEMORY."

set "TXT_STATUS_TITLE=[STATUS] Procesos y servicios"

set "TXT_STATUS_ELECTRON_ON=Electron: en ejecucion"

set "TXT_STATUS_ELECTRON_OFF=Electron: detenido"

set "TXT_STATUS_OLLAMA_ON=Ollama: en ejecucion"

set "TXT_STATUS_OLLAMA_OFF=Ollama: detenido"

set "TXT_STATUS_MEMORY_ON=AGENT_MEMORY.md: actualizado en"

set "TXT_STATUS_MEMORY_OFF=AGENT_MEMORY.md: ausente"

set "TXT_STOP_ALL=[STOP] Cerrando GUI, Node y Ollama..."

set "TXT_STOP_ALL_OK=[OK] Cierre completado."

set "TXT_GUI_WEB_START=[GUI-WEB] Iniciando node --mode gui..."

set "TXT_GUI_WEB_RUNNING=[INFO] GUI web ejecutandose en esta ventana. Usa Ctrl+C para detener. Puede tardar unos 10 segundos en iniciar."

set "TXT_GUI_WEB_FAIL=[ERROR] GUI web finalizo con error."

set "TXT_GUI_WEB_OK=[OK] GUI web finalizada."

set "TXT_DESKTOP_START=[GUI] Iniciando app desktop..."

set "TXT_DESKTOP_RUNNING=[INFO] Desktop ejecutandose en esta ventana. El inicio puede tardar unos 10 segundos."

set "TXT_DESKTOP_FAIL=[ERROR] Desktop finalizo con error."

set "TXT_DESKTOP_OK=[OK] Desktop finalizado."

set "TXT_GUI_STOP_OK=[OK] Procesos de GUI cerrados."

set "TXT_NODE_MISSING=[ERROR] Node.js no encontrado en PATH."

set "TXT_NPM_MISSING=[ERROR] npm no encontrado en PATH."

set "TXT_NODE_INSTALL=[AYUDA] Descarga e instala Node.js 18+: https://nodejs.org"

set "TXT_OLLAMA_MISSING=[ERROR] Ollama no encontrado en PATH."

set "TXT_OLLAMA_INSTALL=[AYUDA] Descarga e instala Ollama: https://ollama.com/download"

set "TXT_DEPS_OK=[OK] node_modules encontrado."

set "TXT_DEPS_INSTALLING=[INFO] Instalando dependencias con npm install..."

set "TXT_DEPS_FAIL=[ERROR] Fallo al instalar dependencias."

set "TXT_DEPS_HINT=[AYUDA] Verifica internet/permisos e intenta de nuevo."

set "TXT_DEPS_DONE=[OK] Dependencias instaladas."

set "TXT_OLLAMA_OK=[OK] Ollama accesible."

set "TXT_OLLAMA_STARTING=[INFO] Iniciando Ollama..."

set "TXT_OLLAMA_STARTED=[OK] Ollama iniciado con exito."

set "TXT_OLLAMA_START_FAIL=[ERROR] No se pudo iniciar Ollama."

set "TXT_MODEL_CHECK=[MODEL] Verificando modelo"

set "TXT_MODEL_OK=[OK] Modelo ya instalado."

set "TXT_MODEL_PULL=[INFO] Descargando modelo"

set "TXT_MODEL_FAIL=[ERROR] Fallo al descargar modelo"

set "TXT_MODEL_DONE=[OK] Modelo instalado."

exit /b 0



:texts_en

set "TXT_TITLE=CodexMemory - Control Center"

set "TXT_MENU_1=Full setup and start Desktop"

set "TXT_MENU_2=Restart Desktop GUI (Electron)"

set "TXT_MENU_3=Restart Ollama"

set "TXT_MENU_4=Force new AGENT_MEMORY"

set "TXT_MENU_5=Show quick status"

set "TXT_MENU_6=Stop everything (GUI + Node + Ollama)"

set "TXT_MENU_7=Start web GUI only (node --mode gui)"

set "TXT_MENU_0=Exit"

set "TXT_PROMPT_OPTION=Choose an option:"

set "TXT_INVALID_OPTION=Invalid option."

set "TXT_BACK_MENU=Press any key to return to menu..."

set "TXT_SETUP_CHECK=[SETUP] Validating environment..."

set "TXT_GUI_RESTART=[GUI] Restarting Desktop..."

set "TXT_OLLAMA_RESTART=[OLLAMA] Restarting service..."

set "TXT_OLLAMA_RESTART_OK=[OK] Ollama restarted."

set "TXT_FORCE_MEMORY=[SYNC] Forcing new AGENT_MEMORY.md..."

set "TXT_FORCE_MEMORY_OK=[OK] AGENT_MEMORY rebuilt successfully."

set "TXT_FORCE_MEMORY_FAIL=[ERROR] Failed to force AGENT_MEMORY."

set "TXT_STATUS_TITLE=[STATUS] Processes and services"

set "TXT_STATUS_ELECTRON_ON=Electron: running"

set "TXT_STATUS_ELECTRON_OFF=Electron: stopped"

set "TXT_STATUS_OLLAMA_ON=Ollama: running"

set "TXT_STATUS_OLLAMA_OFF=Ollama: stopped"

set "TXT_STATUS_MEMORY_ON=AGENT_MEMORY.md: updated at"

set "TXT_STATUS_MEMORY_OFF=AGENT_MEMORY.md: missing"

set "TXT_STOP_ALL=[STOP] Stopping GUI, Node and Ollama..."

set "TXT_STOP_ALL_OK=[OK] Shutdown complete."

set "TXT_GUI_WEB_START=[GUI-WEB] Starting node --mode gui..."

set "TXT_GUI_WEB_RUNNING=[INFO] Web GUI running in this window. Use Ctrl+C to stop. Startup may take around 10 seconds."

set "TXT_GUI_WEB_FAIL=[ERROR] Web GUI exited with error."

set "TXT_GUI_WEB_OK=[OK] Web GUI finished."

set "TXT_DESKTOP_START=[GUI] Starting desktop app..."

set "TXT_DESKTOP_RUNNING=[INFO] Desktop running in this window. Startup may take around 10 seconds."

set "TXT_DESKTOP_FAIL=[ERROR] Desktop exited with error."

set "TXT_DESKTOP_OK=[OK] Desktop finished."

set "TXT_GUI_STOP_OK=[OK] GUI processes stopped."

set "TXT_NODE_MISSING=[ERROR] Node.js not found in PATH."

set "TXT_NPM_MISSING=[ERROR] npm not found in PATH."

set "TXT_NODE_INSTALL=[HELP] Download and install Node.js 18+: https://nodejs.org"

set "TXT_OLLAMA_MISSING=[ERROR] Ollama not found in PATH."

set "TXT_OLLAMA_INSTALL=[HELP] Download and install Ollama: https://ollama.com/download"

set "TXT_DEPS_OK=[OK] node_modules found."

set "TXT_DEPS_INSTALLING=[INFO] Installing dependencies with npm install..."

set "TXT_DEPS_FAIL=[ERROR] Failed to install dependencies."

set "TXT_DEPS_HINT=[HELP] Check internet/permissions and try again."

set "TXT_DEPS_DONE=[OK] Dependencies installed."

set "TXT_OLLAMA_OK=[OK] Ollama reachable."

set "TXT_OLLAMA_STARTING=[INFO] Starting Ollama..."

set "TXT_OLLAMA_STARTED=[OK] Ollama started successfully."

set "TXT_OLLAMA_START_FAIL=[ERROR] Could not start Ollama."

set "TXT_MODEL_CHECK=[MODEL] Ensuring model"

set "TXT_MODEL_OK=[OK] Model already installed."

set "TXT_MODEL_PULL=[INFO] Downloading model"

set "TXT_MODEL_FAIL=[ERROR] Failed to download model"

set "TXT_MODEL_DONE=[OK] Model installed."

exit /b 0



:end

endlocal

exit /b 0

