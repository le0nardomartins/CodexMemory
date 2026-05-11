<p align="center">
  <img src="../../assets/logo_name.png" alt="Codex Memory logo" width="500" />
</p>

<h1 align="center">Codex Memory</h1>

<p align="center">
Orquestração de memória open source para fluxos de trabalho de programação guiados por contexto.
</p>

<p align="center">
  🌐
  <strong>Português</strong> ·
  <a href="../en-US/README.md">English</a> ·
  <a href="../es-ES/README.md">Español</a>
</p>

---

<p align="center">
  <img src="../../assets/example.png" alt="Codex Memory — grafo neural com contexto real" width="860" />
  <br/>
  <sub>Grafo neural com conteúdo de contexto real — cada nó é um arquivo de contexto, cada família de cor é uma área de memória.</sub>
</p>

---

## Visão Geral

O Codex Memory é um serviço de memória local que lê arquivos de contexto em Markdown, consolida memória operacional de longo prazo com um motor selecionável (`ollama` ou `algorithm` determinístico), e expõe uma interface visual para inspecionar relações entre contextos.

O projeto roda em três modos:

1. Aplicativo desktop com Electron
2. Modo GUI via navegador
3. Modo daemon para atualização periódica da memória

## Por que este projeto existe

Arquivos de contexto são fáceis de escrever mas difíceis de manter sincronizados ao longo do tempo. O Codex Memory resolve isso:

1. Consolidando múltiplos arquivos `context_*.md` em um único arquivo operacional
2. Mantendo a memória atualizada via daemon ou sincronização manual
3. Provendo um grafo estilo neural para inspecionar ligações entre nós de contexto
4. Expondo APIs locais para automação e integração

## Funcionalidades Principais

1. Motor de memória selecionável por sessão: `ollama` ou `algorithm` determinístico
2. Atualização automática ou manual do `AGENT_MEMORY.md` com cabeçalho estável e sem linha de timestamp
3. Inicialização rápida da GUI sem bloquear na consolidação
4. CRUD de contextos pela GUI e API
5. Visualização do grafo de contextos com metadados ao hover
6. Snapshot do grafo de neurônios persistido para carregamento mais rápido
7. Interface multilíngue com detecção automática de locale
8. Ícone desktop e branding dos assets do projeto
9. Decisões canônicas com rastreamento de contradições e rastreabilidade de fontes
10. Snapshots do `AGENT_MEMORY.md` com rolagem (últimos 10)

## Contexto Fundamento (`context_1.md`)

`context_1.md` é o contexto fundamento do sistema de memória e deve ser escrito e mantido por um humano.

Por que isso importa:

1. Ele ancora regras de longo prazo e decisões não-negociáveis do projeto.
2. O motor de grafo o trata como neurônio fundamento e o mantém central na visualização.
3. Outros contextos devem referenciá-lo para que a ligação algorítmica preserve uma espinha dorsal de memória consistente.
4. Manter este arquivo curado por humanos reduz desvios e evita perda acidental da intenção central do projeto.

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLAMA_MODEL` | `qwen2.5:3b` | Modelo Ollama usado |
| `MEMORY_ENGINE` | `ollama` | Motor de memória (`ollama` ou `algorithm`) |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Endpoint do Ollama |
| `OLLAMA_TIMEOUT_SEC` | `300` | Timeout das chamadas ao Ollama |
| `OLLAMA_CONTEXT_MAX_CHARS_PER_FILE` | `3500` | Limite de caracteres por arquivo de contexto |
| `OLLAMA_CONTEXT_MAX_TOTAL_CHARS` | `22000` | Limite total de caracteres enviados |
| `DAEMON_REFRESH_SEC` | `300` | Intervalo de refresh do daemon |
| `GUI_HOST` | `127.0.0.1` | Host da GUI |
| `GUI_PORT` | `4173` | Porta da GUI |

Quando `MEMORY_ENGINE=algorithm`, o Ollama não é carregado na sessão.

## Instalação e Execução

Veja o guia completo em [INSTALL.md](INSTALL.md).

## Documentação Técnica

Para detalhes de arquitetura e implementação, leia [TECHNICAL.md](TECHNICAL.md).

## API

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/status` | Status do daemon e engine |
| `POST` | `/api/sync` | Sincronização manual |
| `POST` | `/api/memory/force` | Força consolidação |
| `POST` | `/api/daemon/start` | Inicia daemon |
| `POST` | `/api/daemon/stop` | Para daemon |
| `POST` | `/api/daemon/restart` | Reinicia daemon |
| `GET` | `/api/contexts` | Lista contextos |
| `POST` | `/api/contexts` | Cria contexto |
| `GET` | `/api/contexts/:name` | Lê contexto |
| `PUT` | `/api/contexts/:name` | Atualiza contexto |
| `DELETE` | `/api/contexts/:name` | Remove contexto |
| `GET` | `/api/memory` | Lê memória consolidada |
| `GET` | `/api/graph` | Grafo de neurônios |

## Testes de Regressão

```powershell
npm run test:memory
```