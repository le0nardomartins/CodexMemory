# Documentación Técnica — Codex Memory

<p align="right">
  🌐
  <a href="../pt-BR/TECHNICAL.md">Português</a> ·
  <a href="../en-US/TECHNICAL.md">English</a> ·
  <strong>Español</strong>
</p>

## Propósito

Este documento describe la arquitectura interna, el comportamiento en tiempo de ejecución, el flujo de datos y los puntos de extensión para colaboradores de Codex Memory.

---

## Componentes de Runtime

| Componente | Archivo | Responsabilidad |
|---|---|---|
| Servidor HTTP | `server.js` | API REST, orquestación del motor, consolidación de memoria, snapshot del grafo |
| GUI | `GUI/` | Cliente browser para control operacional, edición de contextos y visualización del grafo |
| Escritorio | `electron/main.js` | Runtime Electron que inicia el servidor GUI y abre la ventana nativa |
| Setup | `setup_codex_memory.bat` | Script Windows para setup, verificación de dependencias y modos de ejecución |
| Config visual | `GUI/config.json` | Parámetros de animación y layout de neuronas (editable sin recompilar) |

---

## Modos de Operación

### Escritorio
Punto de entrada: `npm start`  
Electron inicia el servidor y apunta la ventana a `http://localhost:4173`.

### GUI
Punto de entrada: `node server.js --mode gui`  
Inicia el servidor HTTP y sirve los assets estáticos de la GUI.  
No ejecuta consolidación al arrancar y no inicia el daemon interno automáticamente.

### Daemon
Punto de entrada: `node server.js --mode daemon`  
Actualiza `memory_voult/AGENT_MEMORY.md` periódicamente.  
Usa `--once` para una única pasada.

---

## Modelo de Datos

### Entradas (Contextos)
Ruta: `memory_voult/context/context_*.md`  
Cada archivo es una fuente de memoria. Se cargan durante la consolidación (daemon / sync manual / force), no al arrancar la GUI.

### Fuente del Prompt
Ruta: `OLLAMA_PROMPT.md`  
Se carga en cada llamada de consolidación como base del prompt del sistema para Ollama.

### Salida Consolidada
Ruta: `memory_voult/AGENT_MEMORY.md`  
Generada a partir del contenido de los contextos y las reglas del prompt. La lógica de preservación del encabezado mantiene metadatos estables, fuerza `# AGENT MEMORY` y no incluye línea de timestamp al inicio.

### Archivos de Estado

| Archivo | Contenido |
|---|---|
| `.context_state.json` | Hashes de contexto y métricas de calidad por archivo |
| `.canonical_state.json` | Decisiones canónicas, confianza, enlaces de fuente y linaje de supersesión |
| `.neuron_graph_snapshot.json` | Payload del grafo más reciente para renderización rápida en la GUI |
| `snapshots/AGENT_MEMORY_*.md` | Snapshots con rotación (últimos 10) |
| `.compressed_context_state.json` | Archivo legado mantenido por compatibilidad (compresión deshabilitada) |

---

## Pipeline de Consolidación

```
Trigger (daemon / sync / force)
  ↓
Lee y normaliza archivos de contexto
  ↓
Resuelve motor (MEMORY_ENGINE)
  ↓
  ├── ollama → lee OLLAMA_PROMPT.md → llama a la API de Ollama
  └── algorithm → pipeline determinístico de clasificación semántica
  ↓
Fusiona con encabezado preservado, elimina líneas de timestamp legadas
  ↓
Escribe AGENT_MEMORY.md
  ↓
Persiste snapshot del grafo
```

---

## Motor de Grafo

**Endpoint:** `GET /api/graph`

**Ruta de lectura:**
1. Retorna el grafo persistido en `.neuron_graph_snapshot.json` cuando está disponible
2. Si no existe, reconstruye desde los contextos y persiste el nuevo snapshot

**Creación de nodos:**
- Un nodo por archivo de contexto
- Metadatos: título, categoría, referencias, patrones de mención

**Creación de aristas:**
- Vínculos basados en palabras clave y similitud del análisis de contexto
- Vínculos de co-mención de memoria: líneas que referencian múltiples contextos en `AGENT_MEMORY.md`

**Características de la simulación frontend:**

| Aspecto | Comportamiento |
|---|---|
| Neurona fundamento | Fija en el centro, escala visual aumentada (`foundationScale` en `config.json`) |
| Neuronas normales | Animación idle sinusoidal alrededor de la posición ancla (`homeX`/`homeY`) |
| Zonas de área | Distribución basada en área de memoria con separación iterativa |
| Zoom/pan | Sin límites de borde, navegación infinita |
| Tooltip | Nombre del contexto, conteo de referencias, área |

---

## Configuración de la Red Neural (`GUI/config.json`)

El archivo `GUI/config.json` expone los parámetros visuales y de animación:

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

| Parámetro | Efecto |
|---|---|
| `foundationScale` | Tamaño relativo de la neurona fundamento |
| `normalScale` | Tamaño relativo de las neuronas normales |
| `minSpacing` / `maxSpacing` | Distancia entre neuronas en una zona (world units) |
| `idle.enabled` | Activa/desactiva animación idle |
| `idle.tickSpeed` | Velocidad general de todas las animaciones |
| `idle.freqVariation` | Variación de frecuencia entre neuronas (evita sincronía) |
| `idle.yRatio` | Razón Y/X de frecuencia (crea trayectoria elíptica) |

---

## Internacionalización

Los archivos de locale están en `languages/` y son cargados dinámicamente por la GUI.

**Estrategia actual:**
1. Detecta el idioma preferido del navegador vía `navigator.languages`
2. Mapea al conjunto de locales soportados (`pt-BR`, `en-US`, `es-ES`)
3. Obtiene la tabla de locale mediante endpoint del servidor
4. Aplica etiquetas traducidas a las cadenas estáticas y dinámicas de la interfaz

El alcance de la localización es solo la interfaz. El contenido de la memoria permanece controlado por las reglas de consolidación.

---

## Superficie de API

### Estado

```
GET  /api/status
GET  /api/ollama-status
```

### Sincronización y Memoria

```
POST /api/sync
POST /api/memory/force
GET  /api/memory
PUT  /api/memory
```

### Control del Daemon

```
POST /api/daemon/start
POST /api/daemon/stop
POST /api/daemon/restart
```

### Gestión de Contextos

```
GET    /api/contexts
POST   /api/contexts
GET    /api/contexts/:name
PUT    /api/contexts/:name
DELETE /api/contexts/:name
```

### Grafo y Assets

```
GET /api/graph
GET /api/graph/snapshot
GET /languages/:filename
```

---

## Flujo de Desarrollo

1. `npm install` — instala dependencias
2. `npm start` — modo escritorio para pruebas integradas
3. `node server.js --mode gui` — depuración solo en navegador
4. `node server.js --mode daemon --once` — valida el pipeline de consolidación rápidamente
5. `npm run test:memory` — tests de regresión

---

## Áreas de Enfoque para Contribuciones

1. Seguridad del prompt y controles de calidad de salida
2. Precisión de extracción contexto → memoria
3. Relevancia del grafo y legibilidad visual
4. Cobertura de localización de la UI y calidad del lenguaje
5. Fiabilidad de los scripts operacionales de Windows

---

## Notas de Seguridad

1. El servicio es local-first por diseño
2. El endpoint de Ollama es configurable y debe permanecer en infraestructura local confiable por defecto
3. Los archivos de contexto y memoria pueden contener información sensible del proyecto
4. Evita exponer los puertos GUI y API a redes no confiables
