/**
 * Script de Integración del Sistema Híbrido
 *
 * Este script se puede importar en el agent para activar el sistema híbrido.
 * Alternativa a modificar directamente el código del agent.
 *
 * Uso:
 *   import { integrateHybridSystem } from './hybrid/integration.js';
 *   integrateHybridSystem(agent);
 */

import { HybridSystem, MODE } from './index.js';

let hybridInstance = null;

// Lista completa de todos los bots de la civilización
// CRÍTICO: Todos los bots deben estar aquí para que el ModeManager
// no los cuente como "jugadores humanos" y permita el modo AUTONOMOUS
const ALL_CIVILIZATION_BOTS = [
    'Andy', 'Bruno', 'Carlos', 'Diana', 'Elena',
    'Felix', 'Gina', 'Hugo', 'Iris', 'Juan'
];

/**
 * Integra el sistema híbrido en un agent existente
 * @param {Agent} agent - Instancia del agent de Mindcraft
 * @param {Object} config - Configuración opcional
 */
export function integrateHybridSystem(agent, config = {}) {
    if (hybridInstance) {
        console.log('[Integration] Hybrid system already integrated');
        return hybridInstance;
    }

    const defaultConfig = {
        defaultMode: MODE.HYBRID,
        autonomousDelay: 60000, // 1 minuto
        useVision: true,
        useLLMVerification: true,
        maxRetries: 3,
        taskTimeoutMs: 5 * 60 * 1000, // 5 minutos
        excludeBots: true,
        botNames: ALL_CIVILIZATION_BOTS  // Usar TODOS los bots, no solo el propio
    };

    const finalConfig = { ...defaultConfig, ...config };

    hybridInstance = new HybridSystem(agent, finalConfig);

    // Esperar a que el bot esté spawneado
    if (agent.bot) {
        agent.bot.once('spawn', () => {
            setTimeout(() => {
                hybridInstance.initialize();
                console.log('[Integration] Hybrid system initialized after spawn');
            }, 5000); // Esperar 5 segundos después del spawn
        });

        // Si ya está spawneado
        if (agent.bot.entity) {
            setTimeout(() => {
                hybridInstance.initialize();
                console.log('[Integration] Hybrid system initialized (already spawned)');
            }, 5000);
        }
    }

    // Añadir comandos de chat para controlar el sistema
    _addChatCommands(agent, hybridInstance);

    // Guardar referencia en el agent
    agent.hybrid = hybridInstance;

    console.log('[Integration] Hybrid system integrated successfully');
    return hybridInstance;
}

/**
 * Añade comandos de chat para controlar el sistema híbrido
 */
function _addChatCommands(agent, hybrid) {
    const originalHandleMessage = agent.handleMessage.bind(agent);

    agent.handleMessage = async function(source, message, max_responses) {
        // Comandos especiales del sistema híbrido
        const lowerMessage = message.toLowerCase().trim();

        // !hybrid status
        if (lowerMessage === '!hybrid status' || lowerMessage === '!status') {
            const stats = hybrid.getStats();
            const progress = stats.curriculum || {};

            agent.openChat(`Mode: ${stats.mode?.mode || 'unknown'}`);
            agent.openChat(`Progress: ${progress.completed || 0}/${progress.total || 0} (${progress.percentage || 0}%)`);
            agent.openChat(`Uptime: ${stats.uptime || '0s'}`);
            return;
        }

        // !hybrid mode <mode>
        if (lowerMessage.startsWith('!hybrid mode ')) {
            const mode = lowerMessage.replace('!hybrid mode ', '').trim();
            if (['interactive', 'autonomous', 'hybrid'].includes(mode)) {
                hybrid.setMode(mode);
                agent.openChat(`Mode set to: ${mode}`);
            } else {
                agent.openChat(`Invalid mode. Use: interactive, autonomous, or hybrid`);
            }
            return;
        }

        // !hybrid pause
        if (lowerMessage === '!hybrid pause') {
            if (hybrid.curriculum) {
                hybrid.curriculum.pause();
                agent.openChat('Curriculum paused');
            }
            return;
        }

        // !hybrid resume
        if (lowerMessage === '!hybrid resume') {
            if (hybrid.curriculum) {
                hybrid.curriculum.resume();
                agent.openChat('Curriculum resumed');
            }
            return;
        }

        // !hybrid next
        if (lowerMessage === '!hybrid next') {
            const nextTasks = hybrid.getNextTasks(3);
            if (nextTasks.length > 0) {
                agent.openChat('Next tasks:');
                nextTasks.forEach((t, i) => {
                    agent.openChat(`${i + 1}. ${t.name}`);
                });
            } else {
                agent.openChat('No pending tasks');
            }
            return;
        }

        // !hybrid reset
        if (lowerMessage === '!hybrid reset') {
            hybrid.resetProgress();
            agent.openChat('Progress reset');
            return;
        }

        // Llamar al handler original
        return originalHandleMessage(source, message, max_responses);
    };
}

/**
 * Obtiene la instancia del sistema híbrido
 */
export function getHybridInstance() {
    return hybridInstance;
}

/**
 * Detiene el sistema híbrido
 */
export function stopHybridSystem() {
    if (hybridInstance) {
        hybridInstance.stop();
        hybridInstance = null;
    }
}

export default integrateHybridSystem;
