@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"
set "DEFAULT_OLLAMA_MODEL=qwen2.5:3b"
set "SECONDARY_OLLAMA_MODEL=qwen2.5:1.5b"
set "PY_KIND="
set "PY_VERSION="
set "PY_EXE="
set "PY_INSTALL_ATTEMPTED=0"

echo ========================================
echo   Eleris - Setup do Ambiente
echo ========================================
echo.

:detect_python
set "PY_KIND="
set "PY_VERSION="
set "PY_EXE="

where py >nul 2>nul
if not errorlevel 1 (
    py -3.13 -c "import sys" >nul 2>nul
    if not errorlevel 1 (
        set "PY_KIND=launcher"
        set "PY_VERSION=3.13"
    )
)

if not defined PY_KIND (
    where py >nul 2>nul
    if not errorlevel 1 (
        py -3.12 -c "import sys" >nul 2>nul
        if not errorlevel 1 (
            set "PY_KIND=launcher"
            set "PY_VERSION=3.12"
        )
    )
)

if not defined PY_KIND (
    if exist "%LocalAppData%\Programs\Python\Python313\python.exe" (
        set "PY_KIND=exe"
        set "PY_EXE=%LocalAppData%\Programs\Python\Python313\python.exe"
    )
)

if not defined PY_KIND (
    if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
        set "PY_KIND=exe"
        set "PY_EXE=%LocalAppData%\Programs\Python\Python312\python.exe"
    )
)

if defined PY_KIND goto python_found

if "!PY_INSTALL_ATTEMPTED!"=="1" (
    echo [ERRO] Nao foi possivel localizar Python 3.13 ou 3.12 apos a instalacao.
    echo Feche este terminal, abra novamente e rode setup_venv.bat outra vez.
    goto fail
)

echo [INFO] Python 3.13 ou 3.12 nao encontrado. Tentando instalar Python 3.13 via winget...
where winget >nul 2>nul
if errorlevel 1 (
    echo [ERRO] winget nao foi encontrado no sistema.
    echo Instale Python 3.13 manualmente e rode setup_venv.bat novamente.
    goto fail
)

winget --version >nul 2>nul
if errorlevel 1 (
    echo [ERRO] winget foi encontrado, mas nao conseguiu executar.
    echo Abra o aplicativo "Instalador de Aplicativos" da Microsoft Store e tente de novo.
    goto fail
)

winget install -e --id Python.Python.3.13 --scope user --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 (
    echo [INFO] winget retornou codigo diferente de zero para Python. Vou validar se o Python ficou disponivel.
)

set "PATH=%LocalAppData%\Microsoft\WindowsApps;%PATH%"
set "PY_INSTALL_ATTEMPTED=1"
goto detect_python

:python_found
if defined PIP_NO_INDEX (
    echo [INFO] Variavel PIP_NO_INDEX detectada. Desativando para este setup.
    set "PIP_NO_INDEX="
)

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info < (3, 14) else 1)"
    if errorlevel 1 (
        echo [INFO] .venv atual usa Python 3.14+ e sera recriada com Python compativel.
        rmdir /s /q ".venv"
        if exist ".venv" (
            echo [ERRO] Nao foi possivel remover a pasta .venv.
            goto fail
        )
    )
)

if not exist ".venv\Scripts\python.exe" (
    echo [1/7] Criando a virtual environment...
    if /I "!PY_KIND!"=="launcher" (
        py -!PY_VERSION! -m venv ".venv"
    ) else (
        "!PY_EXE!" -m venv ".venv"
    )
    if errorlevel 1 (
        echo [ERRO] Nao foi possivel criar a virtual environment.
        goto fail
    )
) else (
    echo [1/7] Virtual environment existente encontrada. Reaproveitando.
)

echo [2/7] Ativando a virtual environment...
call ".venv\Scripts\activate.bat"
if errorlevel 1 (
    echo [ERRO] Falha ao ativar a virtual environment.
    goto fail
)

echo [3/7] Atualizando ferramentas de build...
python -m pip install --upgrade pip setuptools wheel
if errorlevel 1 (
    echo [ERRO] Falha ao atualizar pip/setuptools/wheel.
    goto fail
)

echo [4/7] Instalando dependencias do projeto...
python -m pip install -r "requirements.txt"
if errorlevel 1 (
    echo [ERRO] Falha ao instalar as dependencias.
    goto fail
)

echo [5/7] Verificando instalacao do Ollama...
where ollama >nul 2>nul
if errorlevel 1 (
    echo [INFO] Ollama nao encontrado. Tentando instalar via winget...
    where winget >nul 2>nul
    if errorlevel 1 (
        echo [ERRO] winget nao foi encontrado no sistema.
        echo Instale o Ollama manualmente em https://ollama.com/download e rode setup_venv.bat novamente.
        goto fail
    )

    winget --version >nul 2>nul
    if errorlevel 1 (
        echo [ERRO] winget foi encontrado, mas nao conseguiu executar.
        echo Abra o app "Instalador de Aplicativos" da Microsoft Store e tente novamente.
        goto fail
    )

    winget install -e --id Ollama.Ollama --scope user --accept-package-agreements --accept-source-agreements --disable-interactivity
    if errorlevel 1 (
        echo [INFO] winget retornou codigo diferente de zero para Ollama. Vou validar se o Ollama ficou disponivel.
    )

    set "PATH=%LocalAppData%\Programs\Ollama;%ProgramFiles%\Ollama;%PATH%"
    where ollama >nul 2>nul
    if errorlevel 1 (
        echo [ERRO] Ollama nao esta disponivel no PATH desta sessao.
        echo Feche este terminal, abra novamente e rode setup_venv.bat.
        goto fail
    )
)

echo [6/7] Verificando servico do Ollama...
ollama list >nul 2>nul
if errorlevel 1 (
    start "" /B ollama serve >nul 2>nul
    set "OLLAMA_RETRY=0"

    :wait_ollama
    ollama list >nul 2>nul
    if not errorlevel 1 goto ollama_ready

    set /a OLLAMA_RETRY+=1
    if !OLLAMA_RETRY! GEQ 12 (
        echo [ERRO] Nao foi possivel conectar ao servico do Ollama.
        echo Inicie manualmente com: ollama serve
        goto fail
    )

    timeout /t 2 /nobreak >nul
    goto wait_ollama
)

:ollama_ready
echo [7/7] Garantindo modelo padrao do Ollama: %DEFAULT_OLLAMA_MODEL%
set "MODEL_READY=0"
ollama list | findstr /I /C:"%DEFAULT_OLLAMA_MODEL%" >nul
if not errorlevel 1 set "MODEL_READY=1"
if "!MODEL_READY!"=="1" goto model_pull_done

set "PULL_RETRY=0"
:pull_default_retry
set /a PULL_RETRY+=1
echo [INFO] Baixando modelo %DEFAULT_OLLAMA_MODEL% (tentativa !PULL_RETRY!/3). Isso pode levar alguns minutos...
ollama pull "%DEFAULT_OLLAMA_MODEL%"
if errorlevel 1 (
    if !PULL_RETRY! LSS 3 (
        echo [AVISO] Falha de rede ao baixar %DEFAULT_OLLAMA_MODEL%. Tentando novamente em 5 segundos...
        timeout /t 5 /nobreak >nul
        goto pull_default_retry
    )

    echo [AVISO] Nao foi possivel baixar %DEFAULT_OLLAMA_MODEL% agora.
    echo [INFO] Tentando modelo alternativo mais leve: %SECONDARY_OLLAMA_MODEL%
    ollama pull "%SECONDARY_OLLAMA_MODEL%"
    if errorlevel 1 (
        echo [AVISO] Falha temporaria no download dos modelos.
        echo [AVISO] O ambiente foi configurado, mas o chat so respondera apos concluir um download.
        echo [INFO] Tente depois:
        echo         ollama pull %DEFAULT_OLLAMA_MODEL%
        echo     ou  ollama pull %SECONDARY_OLLAMA_MODEL%
    ) else (
        echo [OK] Modelo alternativo instalado: %SECONDARY_OLLAMA_MODEL%
    )
) else (
    echo [OK] Modelo instalado: %DEFAULT_OLLAMA_MODEL%
)

:model_pull_done

echo.
echo [OK] Ambiente pronto.
echo Para iniciar o app agora:
echo python main.py
echo Modelo recomendado: %DEFAULT_OLLAMA_MODEL%
exit /b 0

:fail
echo.
echo Setup finalizado com erro.
exit /b 1
