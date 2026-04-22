# CodexMemory

CodexMemory e um servidor MCP local que mantem a memoria do projeto sempre atualizada para o Codex.
Ele le arquivos de contexto em Markdown, consulta o Ollama para gerar um resumo consolidado, grava `memory_voult/AGENTS.md` e entrega esse conteudo ao Codex via MCP por stdio.

## O Que Ele Faz

- Inicia um servidor MCP em `main.py`.
- Carrega `OLLAMA_prompt.md` a cada atualizacao.
- Le todos os arquivos em `memory_voult/context/*.md`.
- Solicita ao Ollama um unico resumo consolidado.
- Reescreve `memory_voult/AGENTS.md` com:
  - Timestamp na primeira linha no formato `YYYY-MM-DD | HH:MM:SS`
  - Resumo operacional consolidado
  - Lista dos arquivos de contexto processados
- Envia o `AGENTS.md` mais recente ao Codex no `initialize` do MCP, via `instructions`.

## Estrutura Do Projeto

```text
CodexMemory/
  main.py
  OLLAMA_prompt.md
  memory_voult/
    AGENTS.md
    context/
      *.md
```

## Requisitos

- Python 3.10+
- Ollama em execucao local (padrao: `http://127.0.0.1:11434`)
- Um modelo disponivel no Ollama (padrao: `llama3.1`)

## Configuracao

Variaveis de ambiente:

- `OLLAMA_MODEL` (padrao: `llama3.1`)
- `OLLAMA_HOST` (padrao: `http://127.0.0.1:11434`)
- `OLLAMA_TIMEOUT_SEC` (padrao: `120`)

## Execucao

```powershell
python main.py
```

## Recursos MCP

- `memory://agents` -> `AGENTS.md` gerado
- `memory://context/<relative-path>` -> arquivos de contexto brutos

## Observacoes

- `AGENTS.md` e conteudo gerado e pode ser recriado a qualquer momento.
- Se o Ollama estiver indisponivel, o servidor grava um resumo de fallback e continua executando.
