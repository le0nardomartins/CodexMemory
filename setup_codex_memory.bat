@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "DEFAULT_OLLAMA_MODEL=qwen2.5:3b"

echo ========================================
echo   Codex Memory - Start (JS)
echo ========================================
echo.

echo [1/5] Verificando Node.js...
where node >nul 2>nul
if errorlevel 1 goto no_node
node --version

echo [2/5] Verificando dependencias JS...
if not exist "node_modules" (
  echo [INFO] Instalando dependencias com npm install...
  call npm install
  if errorlevel 1 goto fail
) else (
  echo [OK] node_modules encontrado.
)

echo [3/5] Verificando Ollama...
where ollama >nul 2>nul
if not errorlevel 1 goto ollama_ok
echo [ERRO] Ollama nao encontrado no PATH.
echo Instale em: https://ollama.com/download
goto fail

:ollama_ok
echo [4/5] Garantindo servico do Ollama...
call :ensure_ollama
if errorlevel 1 (
  echo [ERRO] Nao consegui conectar no Ollama.
  echo Tente iniciar manualmente: ollama serve
  goto fail
)

echo [5/5] Garantindo modelo %DEFAULT_OLLAMA_MODEL%...
ollama list | findstr /I /C:"%DEFAULT_OLLAMA_MODEL%" >nul
if errorlevel 1 (
  echo [INFO] Baixando modelo %DEFAULT_OLLAMA_MODEL%...
  ollama pull "%DEFAULT_OLLAMA_MODEL%"
  if errorlevel 1 (
    echo [ERRO] Falha ao baixar modelo %DEFAULT_OLLAMA_MODEL%.
    goto fail
  )
)

echo.
echo [OK] Tudo pronto.
echo [INFO] Abrindo app desktop (Electron)...
set "OLLAMA_MODEL=%DEFAULT_OLLAMA_MODEL%"

call npm run desktop
set "SERVER_EXIT=%ERRORLEVEL%"
echo.
echo [INFO] Servidor finalizado com codigo %SERVER_EXIT%.
echo Pressione qualquer tecla para fechar...
pause >nul
exit /b %SERVER_EXIT%

:ensure_ollama
ollama list >nul 2>nul
if not errorlevel 1 exit /b 0

start "" /B ollama serve >nul 2>nul
set "TRY=0"
:wait_ollama
set /a TRY+=1
timeout /t 1 /nobreak >nul
ollama list >nul 2>nul
if not errorlevel 1 exit /b 0
if !TRY! GEQ 20 exit /b 1
goto wait_ollama

:no_node
echo [ERRO] Node.js nao encontrado no PATH.
echo Instale o Node.js 18+ e rode novamente.
goto fail

:fail
echo.
echo Setup falhou.
echo Pressione qualquer tecla para fechar...
pause >nul
exit /b 1
