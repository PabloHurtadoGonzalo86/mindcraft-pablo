# Instalación del Sistema Híbrido - Guía Rápida

## Archivos Creados

```
mindcraft-ce/
├── src/hybrid/
│   ├── curriculum_engine.js   # Motor de progresión (31 tareas hasta Ender Dragon)
│   ├── mode_manager.js        # Gestión automática de modos
│   ├── success_verifier.js    # Verificación multi-método de objetivos
│   ├── index.js               # Integración principal
│   ├── integration.js         # Script de integración fácil
│   └── README.md              # Documentación completa
├── andy-hybrid.json           # Profile optimizado para sistema híbrido
└── INSTALL_HYBRID.md          # Esta guía
```

## Pasos de Instalación

### 1. Habilitar Coding y Vision en settings.js

```javascript
// settings.js - Cambiar estos valores:
"allow_insecure_coding": true,  // IMPORTANTE: Habilita !newAction
"allow_vision": true,           // Habilita análisis visual
"code_timeout_mins": 10,        // Timeout para código generado
```

### 2. Usar el Profile Híbrido

```javascript
// settings.js
"profiles": [
    "./andy-hybrid.json",  // Usar el profile híbrido
],
```

### 3. Integrar el Sistema (Opción A - Modificar agent.js)

Añade al final de `src/agent/agent.js`:

```javascript
import { integrateHybridSystem } from '../hybrid/integration.js';

// En el constructor o método start():
integrateHybridSystem(this);
```

### 3. Integrar el Sistema (Opción B - Sin modificar código)

Crea un archivo `start-hybrid.js`:

```javascript
import * as Mindcraft from './src/mindcraft/mindcraft.js';
import settings from './settings.js';
import { integrateHybridSystem } from './src/hybrid/integration.js';

// Override createAgent para integrar sistema híbrido
const originalCreateAgent = Mindcraft.createAgent;
Mindcraft.createAgent = async (settings) => {
    const result = await originalCreateAgent(settings);
    // Integrar después de crear
    setTimeout(() => {
        const agent = Mindcraft.getAgentProcess(settings.profile.name);
        if (agent) {
            integrateHybridSystem(agent);
        }
    }, 10000);
    return result;
};

// Iniciar normalmente
Mindcraft.init(true, settings.mindserver_port, false);
for (let profile of settings.profiles) {
    const profile_json = JSON.parse(require('fs').readFileSync(profile, 'utf8'));
    settings.profile = profile_json;
    Mindcraft.createAgent(settings);
}
```

### 4. Reconstruir la Imagen Docker

```bash
cd ~/mindcraft-ce
docker build -t ocholoko888/mindcraft-andy:hybrid .
docker push ocholoko888/mindcraft-andy:hybrid
```

### 5. Actualizar el Deployment de Kubernetes

```bash
kubectl set image deployment/mindcraft-andy \
  mindcraft-andy=ocholoko888/mindcraft-andy:hybrid \
  -n minecraft-ai

kubectl rollout restart deployment/mindcraft-andy -n minecraft-ai
```

## Comandos de Chat Disponibles

Una vez integrado, los jugadores pueden usar estos comandos:

| Comando | Descripción |
|---------|-------------|
| `!hybrid status` | Muestra modo actual y progreso |
| `!hybrid mode <mode>` | Cambia modo (interactive/autonomous/hybrid) |
| `!hybrid pause` | Pausa el curriculum |
| `!hybrid resume` | Reanuda el curriculum |
| `!hybrid next` | Muestra próximas tareas pendientes |
| `!hybrid reset` | Reinicia progreso del curriculum |

## Verificar Funcionamiento

```bash
# Ver logs del bot
kubectl logs -f deployment/mindcraft-andy -n minecraft-ai

# Buscar mensajes del sistema híbrido
kubectl logs deployment/mindcraft-andy -n minecraft-ai | grep -E "\[Hybrid|\[Curriculum|\[ModeManager"
```

Deberías ver:
```
[HybridSystem] Initializing hybrid learning system...
[ModeManager] Initialized in hybrid mode
[ModeManager] Players online: 0
[Curriculum] Starting autonomous learning...
[Curriculum] Next task: Obtener 16 bloques de madera
```

## Tiempo Estimado hasta Masterizar

Con el sistema funcionando 24/7:

| Milestone | Tiempo Estimado |
|-----------|-----------------|
| Herramientas de piedra | 2-4 horas |
| Herramientas de hierro | 8-12 horas |
| Diamantes | 20-30 horas |
| Portal al Nether | 30-40 horas |
| Ender Dragon | 60-100+ horas |

*Nota: Tiempos aproximados. Varían según bioma, servidor, y configuración.*

## Troubleshooting

### El bot no ejecuta !newAction
- Verifica `allow_insecure_coding: true` en settings.js
- Revisa que el modelo soporte generación de código

### No cambia a modo autónomo
- Verifica que `autonomousDelay` esté configurado (default: 60000ms)
- Asegúrate de que el bot está en la lista `botNames`

### Las tareas fallan repetidamente
- Aumenta `maxRetries` en la configuración
- Revisa logs para ver qué comando específico falla
- Algunas tareas requieren recursos específicos del mundo

## Soporte

Documentación completa en: `src/hybrid/README.md`

Basado en:
- [Voyager (NVIDIA)](https://voyager.minedojo.org/)
- [Mindcraft-CE](https://github.com/mindcraft-ce/mindcraft-ce)
