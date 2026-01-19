/**
 * Mode Manager - Gestión Automática de Modos
 *
 * Cambia automáticamente entre:
 * - Modo INTERACTIVE: Cuando hay jugadores online, responde a comandos
 * - Modo AUTONOMOUS: Cuando no hay jugadores, ejecuta curriculum learning
 *
 * Eventos de Mineflayer utilizados:
 * - playerJoined: Un jugador entra al servidor
 * - playerLeft: Un jugador sale del servidor
 */

export const MODE = {
    INTERACTIVE: 'interactive',
    AUTONOMOUS: 'autonomous',
    HYBRID: 'hybrid' // Ambos activos, prioridad a jugadores
};

export class ModeManager {
    constructor(agent, curriculumEngine, config = {}) {
        this.agent = agent;
        this.bot = agent.bot;
        this.curriculum = curriculumEngine;

        // Config
        this.mode = config.defaultMode || MODE.HYBRID;
        this.autonomousDelay = config.autonomousDelay || 60000; // 1 minuto sin jugadores antes de modo autónomo
        this.excludeBots = config.excludeBots || true; // No contar otros bots como jugadores
        this.botNames = config.botNames || [agent.name]; // Lista de nombres de bots a excluir

        // State
        this.lastPlayerActivity = Date.now();
        this.playersOnline = new Set();
        this.autonomousTimer = null;
        this.initialized = false;

        // Callbacks externos
        this.onModeChange = config.onModeChange || null;
    }

    /**
     * Inicializa los event listeners
     */
    initialize() {
        if (this.initialized) return;

        // Detectar jugadores que ya están online
        this._scanCurrentPlayers();

        // Event: Jugador entra
        this.bot.on('playerJoined', (player) => {
            this._handlePlayerJoined(player);
        });

        // Event: Jugador sale
        this.bot.on('playerLeft', (player) => {
            this._handlePlayerLeft(player);
        });

        // Event: Chat recibido (indica actividad)
        this.bot.on('chat', (username, message) => {
            if (!this._isBot(username)) {
                this._handlePlayerActivity(username);
            }
        });

        // Event: Whisper recibido
        this.bot.on('whisper', (username, message) => {
            if (!this._isBot(username)) {
                this._handlePlayerActivity(username);
            }
        });

        this.initialized = true;
        console.log(`[ModeManager] Initialized in ${this.mode} mode`);
        console.log(`[ModeManager] Bot exclusion list (${this.botNames.length} bots): ${this.botNames.join(', ')}`);
        console.log(`[ModeManager] Human players online: ${this.playersOnline.size}`);
        if (this.playersOnline.size === 0) {
            console.log(`[ModeManager] No human players detected - autonomous learning will be enabled`);
        }

        // Iniciar en el modo correcto
        this._evaluateMode();
    }

    /**
     * Escanea jugadores actuales en el servidor
     */
    _scanCurrentPlayers() {
        const players = Object.values(this.bot.players || {});

        players.forEach(player => {
            if (player.username && !this._isBot(player.username)) {
                this.playersOnline.add(player.username);
            }
        });

        console.log(`[ModeManager] Found ${this.playersOnline.size} human players online`);
    }

    /**
     * Maneja cuando un jugador entra
     */
    _handlePlayerJoined(player) {
        if (!player?.username) return;

        if (this._isBot(player.username)) {
            console.log(`[ModeManager] Bot joined: ${player.username} (ignored)`);
            return;
        }

        console.log(`[ModeManager] Player joined: ${player.username}`);
        this.playersOnline.add(player.username);
        this._handlePlayerActivity(player.username);
    }

    /**
     * Maneja cuando un jugador sale
     */
    _handlePlayerLeft(player) {
        if (!player?.username) return;

        if (this._isBot(player.username)) {
            return;
        }

        console.log(`[ModeManager] Player left: ${player.username}`);
        this.playersOnline.delete(player.username);
        this._evaluateMode();
    }

    /**
     * Registra actividad de jugador
     */
    _handlePlayerActivity(username) {
        this.lastPlayerActivity = Date.now();

        // Cancelar timer de modo autónomo si existe
        if (this.autonomousTimer) {
            clearTimeout(this.autonomousTimer);
            this.autonomousTimer = null;
        }

        // Si estábamos en modo autónomo, pausar curriculum
        if (this.mode === MODE.AUTONOMOUS && this.curriculum) {
            this._switchToInteractive();
        }
    }

    /**
     * Evalúa y cambia el modo según jugadores online
     */
    _evaluateMode() {
        const humanPlayers = this.playersOnline.size;

        if (humanPlayers > 0) {
            // Hay jugadores - modo interactivo
            if (this.mode === MODE.AUTONOMOUS) {
                this._switchToInteractive();
            }
        } else {
            // No hay jugadores - programar modo autónomo
            this._scheduleAutonomousMode();
        }
    }

    /**
     * Programa el cambio a modo autónomo después del delay
     */
    _scheduleAutonomousMode() {
        if (this.autonomousTimer) return;

        console.log(`[ModeManager] No players online. Switching to autonomous in ${this.autonomousDelay / 1000}s...`);

        this.autonomousTimer = setTimeout(() => {
            this.autonomousTimer = null;

            // Verificar de nuevo que no hay jugadores
            if (this.playersOnline.size === 0) {
                this._switchToAutonomous();
            }
        }, this.autonomousDelay);
    }

    /**
     * Cambia a modo interactivo
     */
    _switchToInteractive() {
        const previousMode = this.mode;
        this.mode = MODE.INTERACTIVE;

        console.log(`[ModeManager] 🎮 Switched to INTERACTIVE mode`);

        // Pausar curriculum
        if (this.curriculum && this.curriculum.isRunning) {
            this.curriculum.pause();
            console.log(`[ModeManager] Curriculum paused - responding to players`);
        }

        // Callback
        if (this.onModeChange) {
            this.onModeChange(MODE.INTERACTIVE, previousMode);
        }

        // Anunciar
        this.agent.openChat("¡Hola! Estoy disponible para ayudar. Escribe en el chat para hablar conmigo.");
    }

    /**
     * Cambia a modo autónomo
     */
    _switchToAutonomous() {
        const previousMode = this.mode;
        this.mode = MODE.AUTONOMOUS;

        console.log(`[ModeManager] 🤖 Switched to AUTONOMOUS mode`);

        // Iniciar/reanudar curriculum
        if (this.curriculum) {
            if (this.curriculum.isRunning) {
                this.curriculum.resume();
                console.log(`[ModeManager] Curriculum resumed`);
            } else {
                this.curriculum.start();
                console.log(`[ModeManager] Curriculum started`);
            }
        }

        // Callback
        if (this.onModeChange) {
            this.onModeChange(MODE.AUTONOMOUS, previousMode);
        }
    }

    /**
     * Verifica si un username es un bot
     */
    _isBot(username) {
        if (!this.excludeBots) return false;
        return this.botNames.includes(username);
    }

    // === API Pública ===

    /**
     * Obtiene el modo actual
     */
    getMode() {
        return this.mode;
    }

    /**
     * Obtiene lista de jugadores online
     */
    getPlayersOnline() {
        return Array.from(this.playersOnline);
    }

    /**
     * Fuerza un modo específico
     */
    setMode(mode) {
        if (!Object.values(MODE).includes(mode)) {
            console.error(`[ModeManager] Invalid mode: ${mode}`);
            return;
        }

        // Cancelar timer si existe
        if (this.autonomousTimer) {
            clearTimeout(this.autonomousTimer);
            this.autonomousTimer = null;
        }

        if (mode === MODE.INTERACTIVE) {
            this._switchToInteractive();
        } else if (mode === MODE.AUTONOMOUS) {
            this._switchToAutonomous();
        } else if (mode === MODE.HYBRID) {
            this.mode = MODE.HYBRID;
            console.log(`[ModeManager] Switched to HYBRID mode`);
            this._evaluateMode();
        }
    }

    /**
     * Añade un bot a la lista de exclusión
     */
    addBotName(name) {
        if (!this.botNames.includes(name)) {
            this.botNames.push(name);
        }
    }

    /**
     * Obtiene estadísticas
     */
    getStats() {
        return {
            mode: this.mode,
            playersOnline: this.playersOnline.size,
            players: Array.from(this.playersOnline),
            lastActivity: this.lastPlayerActivity,
            timeSinceActivity: Date.now() - this.lastPlayerActivity,
            autonomousPending: this.autonomousTimer !== null,
            curriculumRunning: this.curriculum?.isRunning || false,
            curriculumPaused: this.curriculum?.isPaused || false
        };
    }

    /**
     * Detiene el manager
     */
    stop() {
        if (this.autonomousTimer) {
            clearTimeout(this.autonomousTimer);
            this.autonomousTimer = null;
        }

        if (this.curriculum) {
            this.curriculum.stop();
        }

        console.log(`[ModeManager] Stopped`);
    }
}

export default ModeManager;
