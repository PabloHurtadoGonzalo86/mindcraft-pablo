/**
 * Hybrid Learning System - Integración Principal
 *
 * Este módulo integra todos los componentes del sistema híbrido:
 * - CurriculumEngine: Motor de progresión automática
 * - ModeManager: Cambio automático entre modos
 * - SuccessVerifier: Verificación de objetivos
 *
 * Uso:
 *   import { HybridSystem } from './hybrid/index.js';
 *   const hybrid = new HybridSystem(agent, config);
 *   hybrid.initialize();
 */

import { CurriculumEngine } from './curriculum_engine.js';
import { ModeManager, MODE } from './mode_manager.js';
import { SuccessVerifier } from './success_verifier.js';

export { CurriculumEngine, ModeManager, MODE, SuccessVerifier };

export class HybridSystem {
    constructor(agent, config = {}) {
        this.agent = agent;
        this.bot = agent.bot;
        this.config = config;

        // Componentes
        this.curriculum = null;
        this.modeManager = null;
        this.verifier = null;

        // Estado
        this.initialized = false;
        this.stats = {
            startTime: null,
            totalTasksCompleted: 0,
            totalTasksFailed: 0,
            totalPlayTime: 0,
            autonomousTime: 0,
            interactiveTime: 0
        };
    }

    /**
     * Inicializa el sistema híbrido completo
     */
    initialize() {
        if (this.initialized) {
            console.log('[HybridSystem] Already initialized');
            return;
        }

        console.log('[HybridSystem] Initializing hybrid learning system...');

        // 1. Crear SuccessVerifier
        this.verifier = new SuccessVerifier(this.agent, {
            useVision: this.config.useVision || false,
            useLLM: this.config.useLLMVerification !== false,
            strictMode: this.config.strictVerification || false
        });

        // 2. Crear CurriculumEngine
        this.curriculum = new CurriculumEngine(this.agent, {
            dataPath: this.config.curriculumDataPath || `./bots/${this.agent.name}/curriculum/`,
            warmupTasks: this.config.warmupTasks || 5,
            maxRetries: this.config.maxRetries || 3,
            taskTimeoutMs: this.config.taskTimeoutMs || 5 * 60 * 1000
        });

        // 3. Crear ModeManager
        this.modeManager = new ModeManager(this.agent, this.curriculum, {
            defaultMode: this.config.defaultMode || MODE.HYBRID,
            autonomousDelay: this.config.autonomousDelay || 60000,
            excludeBots: this.config.excludeBots !== false,
            botNames: this.config.botNames || [this.agent.name],
            onModeChange: (newMode, oldMode) => this._handleModeChange(newMode, oldMode)
        });

        // 4. Inicializar ModeManager (activa los listeners)
        this.modeManager.initialize();

        // 5. Registrar stats
        this.stats.startTime = Date.now();
        this._startStatsTracking();

        this.initialized = true;
        console.log('[HybridSystem] Initialization complete');
        console.log(`[HybridSystem] Mode: ${this.modeManager.getMode()}`);
        console.log(`[HybridSystem] Curriculum progress: ${this.curriculum.getProgress().percentage}%`);

        return this;
    }

    /**
     * Maneja cambios de modo
     */
    _handleModeChange(newMode, oldMode) {
        console.log(`[HybridSystem] Mode changed: ${oldMode} -> ${newMode}`);

        // Actualizar stats
        const now = Date.now();
        if (this._lastModeChangeTime) {
            const duration = now - this._lastModeChangeTime;
            if (oldMode === MODE.AUTONOMOUS) {
                this.stats.autonomousTime += duration;
            } else if (oldMode === MODE.INTERACTIVE) {
                this.stats.interactiveTime += duration;
            }
        }
        this._lastModeChangeTime = now;

        // Guardar memoria episódica del cambio de modo
        // Usar persistentMemory (nombre correcto del sistema de memoria en el agente)
        const memory = this.agent.persistentMemory || this.agent.memory;
        if (memory?.initialized) {
            memory.remember(
                `Mode changed from ${oldMode} to ${newMode}. Curriculum progress: ${this.curriculum.getProgress().percentage}%`,
                {
                    type: 'mode_change',
                    importance: 7
                }
            ).catch(err => console.error('[HybridSystem] Failed to store mode change:', err));
        }
    }

    /**
     * Inicia tracking de estadísticas
     */
    _startStatsTracking() {
        this._lastModeChangeTime = Date.now();

        // Update stats cada minuto
        this._statsInterval = setInterval(() => {
            this.stats.totalPlayTime = Date.now() - this.stats.startTime;

            const progress = this.curriculum.getProgress();
            this.stats.totalTasksCompleted = progress.completed;
            this.stats.totalTasksFailed = progress.failed;
        }, 60000);
    }

    // === API Pública ===

    /**
     * Obtiene el modo actual
     */
    getMode() {
        return this.modeManager?.getMode() || MODE.HYBRID;
    }

    /**
     * Fuerza un modo específico
     */
    setMode(mode) {
        if (this.modeManager) {
            this.modeManager.setMode(mode);
        }
    }

    /**
     * Obtiene progreso del curriculum
     */
    getProgress() {
        return this.curriculum?.getProgress() || { completed: 0, total: 0, percentage: 0 };
    }

    /**
     * Obtiene estadísticas completas
     */
    getStats() {
        const progress = this.curriculum?.getProgress() || {};
        const modeStats = this.modeManager?.getStats() || {};

        return {
            ...this.stats,
            totalPlayTime: Date.now() - (this.stats.startTime || Date.now()),
            curriculum: progress,
            mode: modeStats,
            uptime: this._formatDuration(Date.now() - (this.stats.startTime || Date.now()))
        };
    }

    /**
     * Obtiene las próximas tareas del curriculum
     */
    getNextTasks(count = 5) {
        return this.curriculum?.getNextTasks(count) || [];
    }

    /**
     * Reinicia el progreso del curriculum
     */
    resetProgress() {
        if (this.curriculum) {
            this.curriculum.resetProgress();
        }
    }

    /**
     * Reintenta tareas fallidas
     */
    retryFailedTasks() {
        if (this.curriculum) {
            this.curriculum.retryFailedTasks();
        }
    }

    /**
     * Verifica un objetivo manualmente
     */
    async verifyTask(task) {
        if (this.verifier) {
            return await this.verifier.verify(task);
        }
        return { success: false, confidence: 0, reason: 'Verifier not initialized' };
    }

    /**
     * Detiene el sistema híbrido
     */
    stop() {
        console.log('[HybridSystem] Stopping...');

        if (this._statsInterval) {
            clearInterval(this._statsInterval);
        }

        if (this.modeManager) {
            this.modeManager.stop();
        }

        if (this.curriculum) {
            this.curriculum.stop();
        }

        this.initialized = false;
        console.log('[HybridSystem] Stopped');
    }

    /**
     * Formatea duración en formato legible
     */
    _formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }
}

export default HybridSystem;
