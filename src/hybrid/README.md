# Sistema Híbrido de Aprendizaje Autónomo para Mindcraft-CE

Sistema de aprendizaje que combina interacción con jugadores y curriculum learning autónomo, inspirado en [Voyager (NVIDIA)](https://voyager.minedojo.org/).

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                    HybridSystem                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ CurriculumEngine│  │  ModeManager    │  │ SuccessVerifier │ │
│  │                 │  │                 │  │                 │ │
│  │ - Tech Tree     │  │ - playerJoined  │  │ - Inventory     │ │
│  │ - Task Queue    │  │ - playerLeft    │  │ - LLM verify    │ │
│  │ - Progress      │  │ - Mode switch   │  │ - Vision verify │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
│           │                    │                    │          │
│           └────────────────────┼────────────────────┘          │
│                                │                               │
│                    ┌───────────▼───────────┐                   │
│                    │   ProceduralMemory    │                   │
│                    │   (Skill Library)     │                   │
│                    │   - Store skills      │                   │
│                    │   - Retrieve by task  │                   │
│                    └───────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

## Instalación

1. Copia la carpeta `src/hybrid/` a tu instalación de Mindcraft-CE

2. Habilita las opciones necesarias en `settings.js`:

```javascript
"allow_insecure_coding": true,  // Permite !newAction
"allow_vision": true,           // Permite análisis visual
"code_timeout_mins": 10,        // Timeout para código generado
```

3. Integra en tu agent (ver sección "Integración")

## Componentes

### CurriculumEngine

Motor de progresión automática con tech tree completo de Minecraft:

- **Fase 1**: Supervivencia básica (madera, crafteo, herramientas de madera)
- **Fase 2**: Herramientas de piedra
- **Fase 3**: Recursos avanzados (carbón, hierro)
- **Fase 4**: Herramientas de hierro y armadura
- **Fase 5**: Diamantes
- **Fase 6**: Portal del Nether
- **Fase 7**: Exploración del Nether
- **Fase 8**: End Game (Ender Dragon)

```javascript
import { CurriculumEngine } from './hybrid/index.js';

const curriculum = new CurriculumEngine(agent, {
    maxRetries: 3,
    taskTimeoutMs: 5 * 60 * 1000
});

curriculum.start(); // Inicia aprendizaje autónomo
curriculum.pause(); // Pausa cuando hay jugadores
curriculum.resume(); // Reanuda
curriculum.getProgress(); // { completed: 10, total: 30, percentage: 33 }
```

### ModeManager

Gestiona automáticamente el cambio entre modos:

- **INTERACTIVE**: Responde a jugadores (prioridad)
- **AUTONOMOUS**: Ejecuta curriculum cuando no hay jugadores
- **HYBRID**: Ambos activos, prioridad a jugadores

```javascript
import { ModeManager, MODE } from './hybrid/index.js';

const modeManager = new ModeManager(agent, curriculum, {
    defaultMode: MODE.HYBRID,
    autonomousDelay: 60000, // 1 minuto sin jugadores
    excludeBots: true
});

modeManager.initialize();
modeManager.getPlayersOnline(); // ['player1', 'player2']
modeManager.setMode(MODE.AUTONOMOUS); // Forzar modo
```

### SuccessVerifier

Verificación multi-método de objetivos:

- Verificación de inventario
- Verificación por categoría (gathering, crafting, building, etc.)
- Verificación con LLM (para tareas complejas)
- Verificación visual (si `allow_vision: true`)

```javascript
import { SuccessVerifier } from './hybrid/index.js';

const verifier = new SuccessVerifier(agent, {
    useVision: true,
    useLLM: true
});

const result = await verifier.verify(task);
// { success: true, confidence: 0.85, reason: 'Items obtained' }
```

## Integración Completa

Añade esto a tu `agent.js` o punto de entrada:

```javascript
import { HybridSystem } from './hybrid/index.js';

// Después de crear el agent
const hybrid = new HybridSystem(agent, {
    defaultMode: 'hybrid',
    autonomousDelay: 60000,
    useVision: true,
    useLLMVerification: true,
    maxRetries: 3,
    taskTimeoutMs: 300000
});

// Inicializar después de que el bot conecte
bot.on('spawn', () => {
    hybrid.initialize();
});

// API disponible
hybrid.getMode();           // 'interactive' | 'autonomous' | 'hybrid'
hybrid.getProgress();       // { completed, total, percentage }
hybrid.getStats();          // Estadísticas completas
hybrid.setMode('autonomous'); // Forzar modo
hybrid.stop();              // Detener sistema
```

## Configuración Completa

```javascript
// settings.js
const settings = {
    // ... otras configuraciones ...

    // Habilitar para sistema híbrido
    "allow_insecure_coding": true,
    "allow_vision": true,
    "code_timeout_mins": 10,

    // Configuración híbrida (opcional, en profile.json)
    "hybrid": {
        "enabled": true,
        "defaultMode": "hybrid",
        "autonomousDelay": 60000,
        "maxRetries": 3,
        "taskTimeoutMs": 300000,
        "useVision": true,
        "useLLMVerification": true,
        "excludeBots": true
    }
}
```

## Tiempo Estimado para Masterizar Minecraft

| Fase | Tareas | Tiempo Estimado (autónomo) |
|------|--------|---------------------------|
| 1. Supervivencia básica | 5 | 30 min - 1 hora |
| 2. Herramientas piedra | 5 | 1 - 2 horas |
| 3. Recursos avanzados | 4 | 2 - 3 horas |
| 4. Hierro completo | 5 | 3 - 5 horas |
| 5. Diamantes | 3 | 5 - 10 horas |
| 6-7. Nether | 6 | 10 - 20 horas |
| 8. Ender Dragon | 3 | 20 - 40+ horas |
| **TOTAL** | **31** | **~40-80 horas** |

*Tiempos estimados con Gemini 3 Flash. Varían según servidor, mobs, bioma inicial, etc.*

## Monitoreo

El sistema guarda progreso en:
- `./bots/{name}/curriculum/progress.json` - Tareas completadas/fallidas
- Qdrant collection `agent_skills` - Skills aprendidos
- Redis - Estado de working memory
- MongoDB - Memoria semántica

## Troubleshooting

### El bot no entra en modo autónomo
- Verifica que `autonomousDelay` sea suficiente
- Asegúrate de que tu bot está en la lista `botNames` para excluirlo

### !newAction no funciona
- Habilita `allow_insecure_coding: true` en settings.js
- Verifica que el modelo soporta generación de código

### Las tareas fallan repetidamente
- Aumenta `maxRetries` y `taskTimeoutMs`
- Revisa los logs para ver qué comando falla
- Algunas tareas requieren condiciones específicas del mundo

## Referencias

- [Voyager Paper](https://arxiv.org/abs/2305.16291) - An Open-Ended Embodied Agent with LLMs
- [Mindcraft-CE](https://github.com/mindcraft-ce/mindcraft-ce) - Framework base
- [Mineflayer](https://github.com/PrismarineJS/mineflayer) - API de Minecraft

## Licencia

MIT - Mismo que Mindcraft-CE
