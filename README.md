# CodexMemory

CodexMemory é um servidor de memória para Codex com 3 modos:

1. `mcp`: expõe memória via MCP (stdio) para o Codex.
2. `daemon`: atualiza memória automaticamente em loop.
3. `gui`: interface web para operar daemon, editar contextos e visualizar sinapses entre contextos.

## O Que Este Projeto Faz

- Lê `memory_voult/context/context_*.md`.
- Lê `OLLAMA_PROMPT.md` sem alterar prompts.
- Consolida memória com Ollama.
- Reescreve `memory_voult/AGENT_MEMORY.md`.
- Sempre grava `data | hora` na primeira linha do arquivo de memória.
- No modo MCP, entrega memória ao Codex em `initialize` e em `resources/read`.

## Stack

- Node.js 18+
- JavaScript puro (backend e frontend)
- Sem dependências externas obrigatórias

## Estrutura

```text
CodexMemory/
  server.js
  package.json
  OLLAMA_PROMPT.md
  CODEX_PROMPT_EXAMPLE.md
  GUI/
    index.html
    styles.css
    app.js
  scripts/
    start-daemon.ps1
    install-autostart.ps1
    status-autostart.ps1
    uninstall-autostart.ps1
  memory_voult/
    AGENT_MEMORY.md
    context/
      context_*.md
```

## Modos De Execução

### 1) MCP (padrão)

```powershell
node server.js
```

### 2) Daemon (loop de atualização)

```powershell
node server.js --mode daemon --refresh-sec 300
```

Teste único:

```powershell
node server.js --mode daemon --once
```

### 3) GUI (interface web)

```powershell
node server.js --mode gui --gui-port 4173
```

Abra: `http://127.0.0.1:4173`

## GUI (Pasta `GUI`)

A interface permite:

- Iniciar, parar e reiniciar daemon.
- Disparar sync manual.
- Criar, listar e editar `context_n.md`.
- Editar `AGENT_MEMORY.md`.
- Visualizar “void neural”:
  - cada contexto é uma bolha;
  - conexões são criadas por NLP simples (keywords + similaridade);
  - o grafo forma uma rede de “sinapses” entre memórias.

## API Da GUI

- `GET /api/status`
- `POST /api/sync`
- `POST /api/daemon/start`
- `POST /api/daemon/stop`
- `POST /api/daemon/restart`
- `GET /api/contexts`
- `POST /api/contexts`
- `GET /api/contexts/:name`
- `PUT /api/contexts/:name`
- `DELETE /api/contexts/:name`
- `GET /api/memory`
- `PUT /api/memory`
- `GET /api/graph`

## Auto-Start Pronto Para Agendar

Você pediu para deixar pronto para agendar depois, então os scripts já estão preparados:

- `scripts/start-daemon.ps1`: launcher com restart e log.
- `scripts/install-autostart.ps1`: cria tarefa agendada.
- `scripts/status-autostart.ps1`: checa status.
- `scripts/uninstall-autostart.ps1`: remove tarefa.

Quando quiser agendar:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
```

## Variáveis De Ambiente

- `OLLAMA_MODEL` (padrão: `llama3.1`)
- `OLLAMA_HOST` (padrão: `http://127.0.0.1:11434`)
- `OLLAMA_TIMEOUT_SEC` (padrão: `120`)
- `DAEMON_REFRESH_SEC` (padrão: `300`)
- `GUI_HOST` (padrão: `127.0.0.1`)
- `GUI_PORT` (padrão: `4173`)

## NPM Scripts

```powershell
npm run mcp
npm run daemon
npm run daemon:once
npm run gui
```

## Observações

- Os prompts de IA (`OLLAMA_PROMPT.md` e `CODEX_PROMPT_EXAMPLE.md`) não foram alterados.
- Se Ollama falhar, o sistema gera fallback e mantém operação.
- Logs do launcher do daemon ficam em `logs/codexmemory-daemon.log`.
