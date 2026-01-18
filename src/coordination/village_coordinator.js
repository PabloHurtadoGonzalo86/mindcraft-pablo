/**
 * Village Coordinator - Inter-bot coordination system
 *
 * Enables bots to share tasks, goals, and status through Redis pub/sub
 * and MongoDB for persistent task storage.
 */

import { createClient } from 'redis';

// Village roles and their priorities
const ROLES = {
    LEADER: { name: 'Andy', priority: 10, tasks: ['coordinate', 'decide', 'assign'] },
    MINER: { name: 'Bruno', priority: 7, tasks: ['mine', 'dig', 'collect_ore'] },
    LUMBERJACK: { name: 'Carlos', priority: 6, tasks: ['chop', 'collect_wood', 'replant'] },
    FARMER: { name: 'Diana', priority: 6, tasks: ['farm', 'harvest', 'breed'] },
    BUILDER: { name: 'Elena', priority: 8, tasks: ['build', 'construct', 'place'] },
    CRAFTER: { name: 'Felix', priority: 7, tasks: ['craft', 'make', 'create'] },
    EXPLORER: { name: 'Gina', priority: 5, tasks: ['explore', 'scout', 'find'] },
    GUARD: { name: 'Hugo', priority: 9, tasks: ['defend', 'attack', 'patrol'] },
    MERCHANT: { name: 'Iris', priority: 6, tasks: ['trade', 'distribute', 'organize'] },
    SMITH: { name: 'Juan', priority: 7, tasks: ['smelt', 'armor', 'forge'] }
};

export class VillageCoordinator {
    constructor(agentName, config = {}) {
        this.agentName = agentName;
        this.role = this._getRoleByName(agentName);
        this.redisClient = null;
        this.subscriber = null;
        this.initialized = false;

        this.config = {
            redisHost: config.redisHost || process.env.REDIS_HOST || 'redis-master',
            redisPort: config.redisPort || process.env.REDIS_PORT || 6379,
            ...config
        };

        // Shared village state
        this.villageState = {
            tasks: [],
            resources: {},
            alerts: [],
            botStatuses: {}
        };

        // Callbacks for events
        this.onTaskAssigned = null;
        this.onAlert = null;
        this.onResourceUpdate = null;
    }

    _getRoleByName(name) {
        for (const [key, role] of Object.entries(ROLES)) {
            if (role.name === name) {
                return { key, ...role };
            }
        }
        return { key: 'UNKNOWN', name, priority: 1, tasks: [] };
    }

    async initialize() {
        try {
            // Connect to Redis
            this.redisClient = createClient({
                socket: {
                    host: this.config.redisHost,
                    port: this.config.redisPort
                }
            });

            this.redisClient.on('error', err => {
                console.error('[VillageCoordinator] Redis error:', err.message);
            });

            await this.redisClient.connect();

            // Create subscriber for pub/sub
            this.subscriber = this.redisClient.duplicate();
            await this.subscriber.connect();

            // Subscribe to village channels
            await this.subscriber.subscribe('village:tasks', (message) => {
                this._handleTaskMessage(message);
            });

            await this.subscriber.subscribe('village:alerts', (message) => {
                this._handleAlertMessage(message);
            });

            await this.subscriber.subscribe('village:status', (message) => {
                this._handleStatusMessage(message);
            });

            // Register this bot
            await this._registerBot();

            this.initialized = true;
            console.log(`[VillageCoordinator] ${this.agentName} (${this.role.key}) initialized`);

            return true;
        } catch (error) {
            console.error('[VillageCoordinator] Initialization failed:', error.message);
            return false;
        }
    }

    async _registerBot() {
        const botInfo = {
            name: this.agentName,
            role: this.role.key,
            status: 'online',
            lastSeen: Date.now(),
            currentTask: null
        };

        await this.redisClient.hSet('village:bots', this.agentName, JSON.stringify(botInfo));
        await this._broadcastStatus('online');
    }

    async _broadcastStatus(status, task = null) {
        const message = {
            bot: this.agentName,
            role: this.role.key,
            status,
            task,
            timestamp: Date.now()
        };

        await this.redisClient.publish('village:status', JSON.stringify(message));
    }

    _handleTaskMessage(message) {
        try {
            const task = JSON.parse(message);

            // Check if task is for this bot
            if (task.assignedTo === this.agentName ||
                task.assignedTo === this.role.key ||
                task.assignedTo === 'ALL') {

                console.log(`[VillageCoordinator] ${this.agentName} received task:`, task.description);

                if (this.onTaskAssigned) {
                    this.onTaskAssigned(task);
                }
            }
        } catch (e) {
            console.error('[VillageCoordinator] Failed to parse task:', e.message);
        }
    }

    _handleAlertMessage(message) {
        try {
            const alert = JSON.parse(message);
            console.log(`[VillageCoordinator] ALERT from ${alert.from}:`, alert.message);

            if (this.onAlert) {
                this.onAlert(alert);
            }
        } catch (e) {
            console.error('[VillageCoordinator] Failed to parse alert:', e.message);
        }
    }

    _handleStatusMessage(message) {
        try {
            const status = JSON.parse(message);
            this.villageState.botStatuses[status.bot] = status;
        } catch (e) {
            // Ignore parse errors
        }
    }

    // === PUBLIC API ===

    /**
     * Assign a task to a specific bot or role
     */
    async assignTask(description, assignedTo, priority = 5) {
        if (!this.initialized) return false;

        const task = {
            id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            description,
            assignedTo,
            assignedBy: this.agentName,
            priority,
            status: 'pending',
            createdAt: Date.now()
        };

        // Store in Redis
        await this.redisClient.lPush('village:task_queue', JSON.stringify(task));

        // Broadcast to all bots
        await this.redisClient.publish('village:tasks', JSON.stringify(task));

        console.log(`[VillageCoordinator] Task assigned to ${assignedTo}: ${description}`);
        return task.id;
    }

    /**
     * Send an alert to all bots
     */
    async sendAlert(message, type = 'info', location = null) {
        if (!this.initialized) return false;

        const alert = {
            from: this.agentName,
            role: this.role.key,
            message,
            type, // 'danger', 'warning', 'info', 'success'
            location,
            timestamp: Date.now()
        };

        await this.redisClient.publish('village:alerts', JSON.stringify(alert));
        console.log(`[VillageCoordinator] Alert sent: ${message}`);
        return true;
    }

    /**
     * Update shared resource count
     */
    async updateResource(resourceName, count, operation = 'set') {
        if (!this.initialized) return false;

        const key = `village:resources:${resourceName}`;

        if (operation === 'add') {
            await this.redisClient.incrBy(key, count);
        } else if (operation === 'subtract') {
            await this.redisClient.decrBy(key, count);
        } else {
            await this.redisClient.set(key, count);
        }

        return true;
    }

    /**
     * Get shared resource count
     */
    async getResource(resourceName) {
        if (!this.initialized) return 0;

        const count = await this.redisClient.get(`village:resources:${resourceName}`);
        return parseInt(count) || 0;
    }

    /**
     * Get all online bots
     */
    async getOnlineBots() {
        if (!this.initialized) return [];

        const bots = await this.redisClient.hGetAll('village:bots');
        return Object.values(bots).map(b => JSON.parse(b));
    }

    /**
     * Update this bot's current task
     */
    async setCurrentTask(taskDescription) {
        if (!this.initialized) return false;

        await this._broadcastStatus('working', taskDescription);
        return true;
    }

    /**
     * Mark this bot as idle
     */
    async setIdle() {
        if (!this.initialized) return false;

        await this._broadcastStatus('idle');
        return true;
    }

    /**
     * Request help from other bots
     */
    async requestHelp(description, requiredRole = null) {
        return this.sendAlert(`HELP NEEDED: ${description}`, 'warning');
    }

    /**
     * Report a discovery to the village
     */
    async reportDiscovery(description, location = null) {
        return this.sendAlert(`DISCOVERY: ${description}`, 'success', location);
    }

    /**
     * Get pending tasks for this bot
     */
    async getPendingTasks() {
        if (!this.initialized) return [];

        const tasks = await this.redisClient.lRange('village:task_queue', 0, -1);
        return tasks
            .map(t => JSON.parse(t))
            .filter(t =>
                t.assignedTo === this.agentName ||
                t.assignedTo === this.role.key ||
                t.assignedTo === 'ALL'
            );
    }

    async shutdown() {
        if (this.subscriber) {
            await this.subscriber.unsubscribe();
            await this.subscriber.quit();
        }
        if (this.redisClient) {
            await this.redisClient.quit();
        }
        this.initialized = false;
    }
}

export { ROLES };
export default VillageCoordinator;
