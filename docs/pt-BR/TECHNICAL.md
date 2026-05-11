# Documentação Técnica — Codex Memory

<p align="right">
  🌐
  <strong>Português</strong> ·
  <a href="../en-US/TECHNICAL.md">English</a> ·
  <a href="../es-ES/TECHNICAL.md">Español</a>
</p>

## Propósito

Este documento descreve a arquitetura interna, comportamento em tempo de execução, fluxo de dados e pontos de extensão para colaboradores do Codex Memory.

---

## Componentes de Runtime

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| Servidor HTTP | `server.js` | API REST, orquestração do motor, consolidação de memória, snapshot do grafo |
| GUI | `GUI/` | Cliente browser para controle operacional, edição de contextos e visualização do grafo |
| Desktop | `electron/main.js` | Runtime Electron que inicia o servidor GUI e abre a janela nativa |
| Setup | `setup_codex_memory.bat` | Script Windows para setup, verificação de dependências e modos de execução |
| Config visual | `GUI/config.json` | Parâmetros de animação e layout dos neurônios (editável sem recompilar) |

---

## Modos de Operação

### Desktop
Ponto de entrada: `npm start`  
O Electron inicia o servidor e aponta a janela para `http://localhost:4173`.

### GUI
Ponto de entrada: `node server.js --mode gui`  
Sobe o servidor HTTP e serve os assets estáticos da GUI.  
Não executa consolidação no boot e não inicia o daemon interno automaticamente.

### Daemon
Ponto de entrada: `node server.js --mode daemon`  
Atualiza `memory_voult/AGENT_MEMORY.md` periodicamente.  
Use `--once` para uma única passada.

---

## Modelo de Dados

### Entradas (Contextos)
Caminho: `memory_voult/context/context_*.md`  
Cada arquivo é uma fonte de memória. Carregados durante consolidação (daemon / sync manual / force), não no boot da GUI.

### Prompt
Caminho: `OLLAMA_PROMPT.md`  
Carregado em cada chamada de consolidação como base do prompt de sistema para o Ollama.

### Saída Consolidada
Caminho: `memory_voult/AGENT_MEMORY.md`  
Gerado a partir dos contextos + regras do prompt. A lógica de preservação de cabeçalho mantém metadados estáveis, enforça `# AGENT MEMORY` e não inclui linha de timestamp no topo.

### Arquivos de Estado

| Arquivo | Conteúdo |
|---|---|
| `.context_state.json` | Hashes de contexto e métricas de qualidade por arquivo |
| `.canonical_state.json` | Decisões canônicas, confiança, links de fonte e linhagem de supersessão |
| `.neuron_graph_snapshot.json` | Payload do grafo mais recente para renderização rápida na GUI |
| `snapshots/AGENT_MEMORY_*.md` | Snapshots com rolagem (últimos 10) |
| `.compressed_context_state.json` | Arquivo legado mantido por compatibilidade (compressão desabilitada) |

---

## Pipeline de Consolidação

```
Trigger (daemon / sync / force)
  ↓
Lê e normaliza arquivos de contexto
  ↓
Resolve motor (MEMORY_ENGINE)
  ↓
  ├── ollama → lê OLLAMA_PROMPT.md → chama API Ollama
  └── algorithm → pipeline determinístico de classificação semântica
  ↓
Mescla com cabeçalho preservado, remove linhas de timestamp legadas
  ↓
Escreve AGENT_MEMORY.md
  ↓
Persiste snapshot do grafo
```

---

## Motor de Grafo

**Endpoint:** `GET /api/graph`

**Caminho de leitura:**
1. Retorna o grafo persistido em `.neuron_graph_snapshot.json` quando disponível
2. Se ausente, reconstrói a partir dos contextos e persiste o novo snapshot

**Criação de nós:**
- Um nó por arquivo de contexto
- Metadados: título, categoria, referências, padrões de menção

**Criação de arestas:**
- Links baseados em palavras-chave e similaridade da análise de contexto
- Links de co-menção da memória: linhas que referenciam múltiplos contextos em `AGENT_MEMORY.md`

**Características da simulação frontend:**

| Aspecto | Comportamento |
|---|---|
| Neurônio fundamento | Fixo no centro, escala visual aumentada (`foundationScale` em `config.json`) |
| Neurônios normais | Animação idle sinusoidal ao redor da posição âncora (`homeX`/`homeY`) |
| Zonas de área | Distribuição baseada em área de memória com separação iterativa |
| Zoom/pan | Sem limites de borda, navegação infinita |
| Tooltip | Nome do contexto, contagem de referências, área |

---

## Configuração da Rede Neural (`GUI/config.json`)

O arquivo `GUI/config.json` expõe os parâmetros visuais e de animação:

```json
{
  "neuron": {
    "foundationScale": 5,
    "normalScale": 2.82,
    "minSpacing": 74,
    "maxSpacing": 190
  },
  "idle": {
    "enabled": true,
    "tickSpeed": 0.018,
    "freqVariation": 0.6,
    "yRatio": 0.71
  }
}
```

| Parâmetro | Efeito |
|---|---|
| `foundationScale` | Tamanho relativo do neurônio fundamento |
| `normalScale` | Tamanho relativo dos neurônios normais |
| `minSpacing` / `maxSpacing` | Distância entre neurônios numa zona (world units) |
| `idle.enabled` | Liga/desliga animação idle |
| `idle.tickSpeed` | Velocidade geral de todas as animações |
| `idle.freqVariation` | Variação de frequência entre neurônios (evita sincronia) |
| `idle.yRatio` | Razão Y/X de frequência (cria trajetória elíptica) |

---

## Internacionalização

Os arquivos de locale estão em `languages/` e são carregados dinamicamente pela GUI.

**Estratégia atual:**
1. Detecta o idioma preferido do navegador via `navigator.languages`
2. Mapeia para o conjunto de locales suportados (`pt-BR`, `en-US`, `es-ES`)
3. Busca a tabela de locale via endpoint do servidor
4. Aplica rótulos traduzidos nas strings estáticas e dinâmicas da interface

O escopo da localização é apenas a interface. O conteúdo da memória permanece controlado pelas regras de consolidação.

---

## Superfície de API

### Status

```
GET  /api/status
GET  /api/ollama-status
```

### Sincronização e Memória

```
POST /api/sync
POST /api/memory/force
GET  /api/memory
PUT  /api/memory
```

### Controle do Daemon

```
POST /api/daemon/start
POST /api/daemon/stop
POST /api/daemon/restart
```

### Gestão de Contextos

```
GET    /api/contexts
POST   /api/contexts
GET    /api/contexts/:name
PUT    /api/contexts/:name
DELETE /api/contexts/:name
```

### Grafo e Assets

```
GET /api/graph
GET /api/graph/snapshot
GET /languages/:filename
```

---

## Fluxo de Desenvolvimento

1. `npm install` — instala dependências
2. `npm start` — modo desktop para testes integrados
3. `node server.js --mode gui` — debug somente browser
4. `node server.js --mode daemon --once` — valida pipeline de consolidação rapidamente
5. `npm run test:memory` — testes de regressão

---

## Áreas de Foco para Contribuição

1. Segurança do prompt e controles de qualidade de saída
2. Acurácia da extração contexto → memória
3. Relevância do grafo e legibilidade visual
4. Cobertura de localização da UI e qualidade de linguagem
5. Confiabilidade dos scripts operacionais Windows

---

## Notas de Segurança

1. O serviço é local-first por design
2. O endpoint do Ollama é configurável e deve permanecer em infraestrutura local confiável por padrão
3. Arquivos de contexto e memória podem conter informações sensíveis do projeto
4. Evite expor as portas GUI e API para redes não confiáveis
