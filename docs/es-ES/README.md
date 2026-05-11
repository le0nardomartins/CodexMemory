<p align="center">
  <img src="../../assets/logo_name.png" alt="Codex Memory logo" width="500" />
</p>

<h1 align="center">Codex Memory</h1>

<p align="center">
Orquestación de memoria open source para flujos de trabajo de programación guiados por contexto.
</p>

<p align="center">
  🌐
  <a href="../pt-BR/README.md">Português</a> ·
  <a href="../en-US/README.md">English</a> ·
  <strong>Español</strong>
</p>

---

## Visión General

Codex Memory es un servicio de memoria local que lee archivos de contexto en Markdown, consolida memoria operacional a largo plazo con un motor seleccionable (`ollama` o `algorithm` determinístico), y expone una interfaz visual para inspeccionar relaciones entre contextos.

El proyecto funciona en tres modos:

1. Aplicación de escritorio con Electron
2. Modo GUI en el navegador
3. Modo daemon para actualización periódica de la memoria

## Por Qué Existe Este Proyecto

Los archivos de contexto son fáciles de escribir pero difíciles de mantener sincronizados con el tiempo. Codex Memory resuelve esto:

1. Consolidando múltiples archivos `context_*.md` en un único archivo operacional
2. Manteniendo la memoria actualizada mediante daemon o sincronización manual
3. Proporcionando un grafo estilo neural para inspeccionar los vínculos entre nodos de contexto
4. Exponiendo APIs locales para automatización e integración

## Características Principales

1. Motor de memoria seleccionable por sesión: `ollama` o `algorithm` determinístico
2. Actualización automática o manual del `AGENT_MEMORY.md` con encabezado estable y sin línea de timestamp
3. Inicio rápido de la GUI sin bloquear la consolidación al arrancar
4. CRUD de contextos desde GUI y API
5. Visualización del grafo de contextos con metadatos al hover
6. Snapshot del grafo de neuronas persistido para carga más rápida
7. Interfaz multilingüe con detección automática del locale
8. Icono de escritorio y branding desde los assets del proyecto
9. Decisiones canónicas con seguimiento de contradicciones y trazabilidad de fuentes
10. Snapshots del `AGENT_MEMORY.md` con rotación (últimos 10)

## Contexto Fundamento (`context_1.md`)

`context_1.md` es el contexto fundamento del sistema de memoria y debe ser escrito y mantenido por un humano.

Por qué importa:

1. Ancla las reglas a largo plazo y las decisiones no negociables del proyecto.
2. El motor del grafo lo trata como neurona fundamento y lo mantiene central en la visualización.
3. Otros contextos deben referenciarlo para que el enlace algorítmico preserve una columna vertebral de memoria consistente.
4. Mantener este archivo curado por humanos reduce la deriva y evita la pérdida accidental de la intención central del proyecto.

## Estructura del Proyecto

```text
CodexMemory/
  electron/
    main.js
  GUI/
    index.html
    app.js
    styles.css
    config.json          ← configuración visual de la red neural
    languages/
  languages/
    en-US.json
    pt-BR.json
    es-ES.json
  memory_voult/
    AGENT_MEMORY.md
    .context_state.json
    .canonical_state.json
    .neuron_graph_snapshot.json
    snapshots/
    context/
      context_*.md
  assets/
  scripts/
  docs/
    pt-BR/
    en-US/
    es-ES/
  server.js
  setup_codex_memory.bat
```

## Variables de Entorno

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `OLLAMA_MODEL` | `qwen2.5:3b` | Modelo Ollama a usar |
| `MEMORY_ENGINE` | `ollama` | Motor de memoria (`ollama` o `algorithm`) |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Endpoint de Ollama |
| `OLLAMA_TIMEOUT_SEC` | `300` | Timeout de las llamadas a Ollama |
| `OLLAMA_CONTEXT_MAX_CHARS_PER_FILE` | `3500` | Límite de caracteres por archivo de contexto |
| `OLLAMA_CONTEXT_MAX_TOTAL_CHARS` | `22000` | Total máximo de caracteres enviados |
| `DAEMON_REFRESH_SEC` | `300` | Intervalo de refresco del daemon |
| `GUI_HOST` | `127.0.0.1` | Host de la GUI |
| `GUI_PORT` | `4173` | Puerto de la GUI |

Cuando `MEMORY_ENGINE=algorithm`, Ollama no se carga en la sesión.

## Instalación y Ejecución

Consulta la guía completa en [INSTALL.md](INSTALL.md).

## Documentación Técnica

Para detalles de arquitectura e implementación, lee [TECHNICAL.md](TECHNICAL.md).

## API

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/status` | Estado del daemon y motor |
| `POST` | `/api/sync` | Sincronización manual |
| `POST` | `/api/memory/force` | Fuerza consolidación |
| `POST` | `/api/daemon/start` | Inicia daemon |
| `POST` | `/api/daemon/stop` | Detiene daemon |
| `POST` | `/api/daemon/restart` | Reinicia daemon |
| `GET` | `/api/contexts` | Lista contextos |
| `POST` | `/api/contexts` | Crea contexto |
| `GET` | `/api/contexts/:name` | Lee contexto |
| `PUT` | `/api/contexts/:name` | Actualiza contexto |
| `DELETE` | `/api/contexts/:name` | Elimina contexto |
| `GET` | `/api/memory` | Lee memoria consolidada |
| `GET` | `/api/graph` | Grafo de neuronas |

## Tests de Regresión

```powershell
npm run test:memory
```

## Notas Open Source

1. Límites claros de código entre GUI, servidor y runtime de escritorio
2. No se requieren servicios remotos ocultos para el flujo principal
3. Comportamiento local-first por defecto
4. Modelo de contexto basado en Markdown amigable para la comunidad
