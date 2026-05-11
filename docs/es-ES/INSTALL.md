# Guía de Instalación — Codex Memory

<p align="right">
  🌐
  <a href="../pt-BR/INSTALL.md">Português</a> ·
  <a href="../en-US/INSTALL.md">English</a> ·
  <strong>Español</strong>
</p>

## Requisitos

| Dependencia | Versión mínima | Nota |
|---|---|---|
| Node.js | 18+ | Siempre requerido |
| Ollama | Cualquiera | Solo si `MEMORY_ENGINE=ollama` |

Ollama debe estar disponible en el `PATH` con el modelo configurado instalado. Para ejecutar sin LLM, usa `MEMORY_ENGINE=algorithm`.

---

## 1. Clonar e Instalar Dependencias

```powershell
git clone https://github.com/le0nardomartins/CodexMemory.git
cd CodexMemory
npm install
```

---

## 2. Configurar Rutas

Antes de la primera ejecución, crea el archivo de configuración de rutas a partir del ejemplo:

```powershell
copy config\ai_paths.json.example config\ai_paths.json
```

Abre `config/ai_paths.json` y define la ruta base absoluta a tu carpeta padre:

```json
{
  "baseRootPath": "C:/Users/tu_usuario/Documents"
}
```

> Usa barras `/` en JSON incluso en Windows.

---

## 3. Modos de Ejecución

### Escritorio (Electron)

Abre la ventana nativa con GUI integrada:

```powershell
npm start
```

### GUI en el Navegador

Inicia el servidor HTTP y sirve la GUI en `http://localhost:4173`:

```powershell
node server.js --mode gui
```

Puerto y host personalizados:

```powershell
node server.js --mode gui --port 8080 --host 0.0.0.0
```

### Daemon (refresco automático)

Actualiza `AGENT_MEMORY.md` periódicamente (por defecto: 300 segundos):

```powershell
node server.js --mode daemon --refresh-sec 300
```

Ejecución única (sin bucle):

```powershell
node server.js --mode daemon --once
```

---

## 4. Variables de Entorno

Crea un archivo `.env` en la raíz o exporta las variables antes de ejecutar:

```powershell
$env:MEMORY_ENGINE = "algorithm"   # o "ollama"
$env:OLLAMA_MODEL  = "qwen2.5:3b"
$env:GUI_PORT      = "4173"
```

O en el archivo `.env`:

```
MEMORY_ENGINE=algorithm
OLLAMA_MODEL=qwen2.5:3b
GUI_PORT=4173
```

---

## 5. Inicio Automático en Windows (opcional)

Los scripts en `scripts/` permiten instalar el daemon como tarea programada de Windows:

```powershell
# Instalar como tarea programada
.\scripts\install-autostart.ps1

# Verificar estado
.\scripts\status-autostart.ps1

# Desinstalar
.\scripts\uninstall-autostart.ps1
```

---

## 6. Verificar la Instalación

Después de iniciar el servidor, confirma que está funcionando:

```powershell
curl http://localhost:4173/api/status
```

Respuesta esperada:

```json
{
  "daemon": { "running": false },
  "ollama": { "reachable": true, "modelInstalled": true }
}
```

---

## Resolución de Problemas

| Problema | Causa probable | Solución |
|---|---|---|
| `EADDRINUSE` en el puerto 4173 | Otra instancia en ejecución | Cierra el proceso o cambia `GUI_PORT` |
| Ollama no encontrado | No instalado o fuera del PATH | Instala Ollama o usa `MEMORY_ENGINE=algorithm` |
| `config/ai_paths.json` no existe | Ejemplo no copiado | Ejecuta el `copy` del paso 2 |
| Neuronas no aparecen en la GUI | Grafo aún no generado | Haz clic en "Sync Now" para forzar la consolidación |
