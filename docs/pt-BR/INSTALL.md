# Guia de Instalação — Codex Memory

<p align="right">
  🌐
  <strong>Português</strong> ·
  <a href="../en-US/INSTALL.md">English</a> ·
  <a href="../es-ES/INSTALL.md">Español</a>
</p>

## Requisitos

| Dependência | Versão mínima | Observação |
|---|---|---|
| Node.js | 18+ | Necessário sempre |
| Ollama | Qualquer | Necessário apenas se `MEMORY_ENGINE=ollama` |

O Ollama precisa estar disponível no `PATH` e com o modelo configurado instalado. Se preferir rodar sem LLM, use `MEMORY_ENGINE=algorithm`.

---

## 1. Clonar e Instalar Dependências

```powershell
git clone https://github.com/le0nardomartins/CodexMemory.git
cd CodexMemory
npm install
```

---

## 2. Configurar Caminhos

Antes da primeira execução, crie o arquivo de configuração de caminhos a partir do exemplo:

```powershell
copy config\ai_paths.json.example config\ai_paths.json
```

Abra `config/ai_paths.json` e defina o caminho base absoluto para sua pasta pai:

```json
{
  "baseRootPath": "C:/Users/seu_usuario/Documents"
}
```

> Use barras `/` no JSON mesmo no Windows.

---

## 3. Modos de Execução

### Desktop (Electron)

Abre a janela nativa com GUI integrada:

```powershell
npm start
```

### GUI via Navegador

Inicia o servidor HTTP e abre `http://localhost:4173` no navegador:

```powershell
node server.js --mode gui
```

Porta e host personalizados:

```powershell
node server.js --mode gui --port 8080 --host 0.0.0.0
```

### Daemon (refresh automático)

Atualiza `AGENT_MEMORY.md` periodicamente (padrão: 300 segundos):

```powershell
node server.js --mode daemon --refresh-sec 300
```

Execução única (sem loop):

```powershell
node server.js --mode daemon --once
```

---

## 4. Variáveis de Ambiente

Crie um arquivo `.env` na raiz ou exporte as variáveis antes de executar:

```powershell
$env:MEMORY_ENGINE = "algorithm"   # ou "ollama"
$env:OLLAMA_MODEL  = "qwen2.5:3b"
$env:GUI_PORT      = "4173"
```

Ou no arquivo `.env` (se o projeto carregar dotenv):

```
MEMORY_ENGINE=algorithm
OLLAMA_MODEL=qwen2.5:3b
GUI_PORT=4173
```

---

## 5. Autostart no Windows (opcional)

Os scripts em `scripts/` permitem instalar o daemon como tarefa agendada do Windows:

```powershell
# Instalar como tarefa agendada
.\scripts\install-autostart.ps1

# Verificar status
.\scripts\status-autostart.ps1

# Desinstalar
.\scripts\uninstall-autostart.ps1
```

---

## 6. Verificação da Instalação

Após subir o servidor, confirme que está funcionando:

```powershell
curl http://localhost:4173/api/status
```

Resposta esperada:

```json
{
  "daemon": { "running": false },
  "ollama": { "reachable": true, "modelInstalled": true }
}
```

---

## Resolução de Problemas

| Problema | Causa provável | Solução |
|---|---|---|
| `EADDRINUSE` na porta 4173 | Outra instância rodando | Encerre o processo ou mude `GUI_PORT` |
| Ollama não encontrado | Não instalado ou fora do PATH | Instale o Ollama ou use `MEMORY_ENGINE=algorithm` |
| `config/ai_paths.json` não existe | Arquivo de exemplo não copiado | Execute o `copy` do passo 2 |
| Neurônios não aparecem na GUI | Grafo ainda não gerado | Clique em "Sync Agora" para forçar consolidação |
