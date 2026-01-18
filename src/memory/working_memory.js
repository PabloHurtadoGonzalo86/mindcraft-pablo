/**
 * Working Memory System using Redis
 * Handles current context, attention state, and message buffers
 */

import { createClient } from 'redis';

export class WorkingMemory {
    constructor(config = {}) {
        this.redisHost = config.redisHost || process.env.REDIS_HOST || 'redis-master.minecraft-ai.svc.cluster.local';
        this.redisPort = config.redisPort || process.env.REDIS_PORT || 6379;
        this.client = null;
        this.connected = false;
        this.agentName = config.agentName || 'Andy';

        // Key prefixes
        this.prefix = `mindcraft:${this.agentName}:`;

        // TTL for different data types (in seconds)
        this.ttl = {
            currentGoal: 3600,      // 1 hour
            attention: 300,          // 5 minutes
            messageBuffer: 600,      // 10 minutes
            playerContext: 1800,     // 30 minutes
            gameState: 60            // 1 minute
        };
    }

    async connect() {
        if (this.connected) return true;

        try {
            this.client = createClient({
                socket: {
                    host: this.redisHost,
                    port: this.redisPort
                }
            });

            this.client.on('error', (err) => {
                console.error('[WorkingMemory] Redis error:', err.message);
            });

            await this.client.connect();
            this.connected = true;
            console.log(`[WorkingMemory] Connected to Redis at ${this.redisHost}:${this.redisPort}`);
            return true;
        } catch (error) {
            console.error('[WorkingMemory] Failed to connect:', error.message);
            return false;
        }
    }

    async disconnect() {
        if (this.client && this.connected) {
            await this.client.quit();
            this.connected = false;
        }
    }

    // ==================== Current Goal ====================

    async setCurrentGoal(goal, priority = 5) {
        if (!this.connected) await this.connect();

        const data = JSON.stringify({
            goal: goal,
            priority: priority,
            setAt: new Date().toISOString()
        });

        await this.client.setEx(
            `${this.prefix}goal:current`,
            this.ttl.currentGoal,
            data
        );
    }

    async getCurrentGoal() {
        if (!this.connected) await this.connect();

        const data = await this.client.get(`${this.prefix}goal:current`);
        return data ? JSON.parse(data) : null;
    }

    async clearGoal() {
        if (!this.connected) await this.connect();
        await this.client.del(`${this.prefix}goal:current`);
    }

    // ==================== Attention State ====================

    async setAttention(target, type = 'entity') {
        if (!this.connected) await this.connect();

        const data = JSON.stringify({
            target: target,
            type: type, // 'entity', 'location', 'task'
            focusedAt: new Date().toISOString()
        });

        await this.client.setEx(
            `${this.prefix}attention`,
            this.ttl.attention,
            data
        );
    }

    async getAttention() {
        if (!this.connected) await this.connect();

        const data = await this.client.get(`${this.prefix}attention`);
        return data ? JSON.parse(data) : null;
    }

    // ==================== Message Buffer ====================

    async addMessage(sender, content, type = 'chat') {
        if (!this.connected) await this.connect();

        const message = JSON.stringify({
            sender: sender,
            content: content,
            type: type,
            timestamp: new Date().toISOString()
        });

        const key = `${this.prefix}messages`;

        // Add to list (LPUSH for newest first)
        await this.client.lPush(key, message);

        // Trim to keep only last 50 messages
        await this.client.lTrim(key, 0, 49);

        // Set expiry
        await this.client.expire(key, this.ttl.messageBuffer);
    }

    async getRecentMessages(count = 10) {
        if (!this.connected) await this.connect();

        const messages = await this.client.lRange(
            `${this.prefix}messages`,
            0,
            count - 1
        );

        return messages.map(m => JSON.parse(m));
    }

    // ==================== Player Context ====================

    async setPlayerContext(playerName, context) {
        if (!this.connected) await this.connect();

        const data = JSON.stringify({
            ...context,
            lastInteraction: new Date().toISOString()
        });

        await this.client.setEx(
            `${this.prefix}player:${playerName}`,
            this.ttl.playerContext,
            data
        );
    }

    async getPlayerContext(playerName) {
        if (!this.connected) await this.connect();

        const data = await this.client.get(`${this.prefix}player:${playerName}`);
        return data ? JSON.parse(data) : null;
    }

    async getAllPlayerContexts() {
        if (!this.connected) await this.connect();

        const keys = await this.client.keys(`${this.prefix}player:*`);
        const contexts = {};

        for (const key of keys) {
            const playerName = key.replace(`${this.prefix}player:`, '');
            const data = await this.client.get(key);
            if (data) {
                contexts[playerName] = JSON.parse(data);
            }
        }

        return contexts;
    }

    // ==================== Game State ====================

    async setGameState(state) {
        if (!this.connected) await this.connect();

        const data = JSON.stringify({
            ...state,
            updatedAt: new Date().toISOString()
        });

        await this.client.setEx(
            `${this.prefix}gameState`,
            this.ttl.gameState,
            data
        );
    }

    async getGameState() {
        if (!this.connected) await this.connect();

        const data = await this.client.get(`${this.prefix}gameState`);
        return data ? JSON.parse(data) : null;
    }

    // ==================== Context Summary ====================

    async getContextSummary() {
        if (!this.connected) await this.connect();

        const [goal, attention, messages, gameState] = await Promise.all([
            this.getCurrentGoal(),
            this.getAttention(),
            this.getRecentMessages(5),
            this.getGameState()
        ]);

        return {
            currentGoal: goal,
            attention: attention,
            recentMessages: messages,
            gameState: gameState
        };
    }

    /**
     * Format working memory for prompt injection
     */
    formatForPrompt() {
        // This will be called with the context summary
        return async () => {
            const context = await this.getContextSummary();

            let prompt = '';

            if (context.currentGoal) {
                prompt += `Current Goal: ${context.currentGoal.goal} (priority: ${context.currentGoal.priority})\n`;
            }

            if (context.attention) {
                prompt += `Focusing on: ${context.attention.target} (${context.attention.type})\n`;
            }

            if (context.recentMessages && context.recentMessages.length > 0) {
                prompt += `Recent conversation:\n`;
                context.recentMessages.slice(0, 3).forEach(m => {
                    prompt += `  - ${m.sender}: ${m.content}\n`;
                });
            }

            return prompt;
        };
    }
}

export default WorkingMemory;
