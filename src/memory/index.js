/**
 * Persistent Memory System for Minecraft AI Agent
 *
 * Complete 4-Layer Memory Architecture:
 * 1. Episodic Memory (Qdrant): Long-term experiences with semantic search
 * 2. Working Memory (Redis): Current context and attention state
 * 3. Semantic Memory (MongoDB): General knowledge - recipes, mobs, relations, locations
 * 4. Procedural Memory (Qdrant): Learned skills as executable code
 *
 * Based on "Generative Agents" paper by Stanford
 */

import { EpisodicMemory } from './episodic_memory.js';
import { WorkingMemory } from './working_memory.js';
import { EmbeddingsGenerator } from './embeddings.js';
import { SemanticMemory } from './semantic_memory.js';
import { ProceduralMemory } from './procedural_memory.js';

export class PersistentMemorySystem {
    constructor(config = {}) {
        this.agentName = config.agentName || 'Andy';

        // Initialize Embeddings Generator first (shared by multiple components)
        this.embeddings = new EmbeddingsGenerator({
            apiKey: config.geminiApiKey
        });

        // 1. Episodic Memory - experiences and observations
        this.episodic = new EpisodicMemory({
            qdrantHost: config.qdrantHost,
            qdrantPort: config.qdrantPort,
            collectionName: config.collectionName || 'agent_memories'
        });

        // 2. Working Memory - current context
        this.working = new WorkingMemory({
            redisHost: config.redisHost,
            redisPort: config.redisPort,
            agentName: this.agentName
        });

        // 3. Semantic Memory - general knowledge
        this.semantic = new SemanticMemory({
            mongoHost: config.mongoHost || process.env.MONGO_HOST || 'mongodb.minecraft-ai.svc.cluster.local',
            mongoPort: config.mongoPort || process.env.MONGO_PORT || 27017,
            mongoUser: config.mongoUser || process.env.MONGO_USER || 'mindcraft',
            mongoPassword: config.mongoPassword || process.env.MONGO_PASSWORD || 'mindcraft_user_2026',
            agentName: this.agentName
        });

        // 4. Procedural Memory - learned skills
        this.procedural = new ProceduralMemory({
            qdrantHost: config.qdrantHost,
            qdrantPort: config.qdrantPort,
            agentName: this.agentName,
            embeddingsGenerator: this.embeddings
        });

        this.initialized = false;
    }

    async initialize() {
        console.log(`[MemorySystem] Initializing 4-layer memory for agent: ${this.agentName}`);

        try {
            // Initialize all components in parallel
            const [episodicOk, workingOk, semanticOk, proceduralOk] = await Promise.all([
                this.episodic.initialize(),
                this.working.connect(),
                this.semantic.connect(),
                this.procedural.initialize()
            ]);

            // Report status
            console.log(`[MemorySystem] Episodic (Qdrant):    ${episodicOk ? '✓' : '✗'}`);
            console.log(`[MemorySystem] Working (Redis):      ${workingOk ? '✓' : '✗'}`);
            console.log(`[MemorySystem] Semantic (MongoDB):   ${semanticOk ? '✓' : '✗'}`);
            console.log(`[MemorySystem] Procedural (Qdrant):  ${proceduralOk ? '✓' : '✗'}`);

            // At minimum, episodic and working must work
            if (episodicOk && workingOk) {
                this.initialized = true;
                console.log('[MemorySystem] Core components initialized successfully');

                // Get stats
                const episodicStats = await this.episodic.getStats();
                if (episodicStats) {
                    console.log(`[MemorySystem] Episodic memory: ${episodicStats.pointsCount} memories`);
                }

                if (semanticOk) {
                    const semanticStats = await this.semantic.getStats();
                    if (semanticStats) {
                        console.log(`[MemorySystem] Semantic memory: ${semanticStats.total} facts`);
                    }
                }

                if (proceduralOk) {
                    const proceduralStats = await this.procedural.getStats();
                    if (proceduralStats) {
                        console.log(`[MemorySystem] Procedural memory: ${proceduralStats.totalSkills} skills`);
                    }
                }

                return true;
            } else {
                console.error('[MemorySystem] Core components failed to initialize');
                return false;
            }
        } catch (error) {
            console.error('[MemorySystem] Initialization failed:', error.message);
            return false;
        }
    }

    // ==================== Episodic Memory Operations ====================

    /**
     * Store a new experience/observation (Episodic)
     */
    async remember(description, options = {}) {
        if (!this.initialized) {
            console.warn('[MemorySystem] Not initialized, skipping remember');
            return null;
        }

        try {
            const embedding = await this.embeddings.embed(description);

            const memoryId = await this.episodic.storeMemory({
                description: description,
                embedding: embedding,
                type: options.type || 'observation',
                gameTime: options.gameTime,
                location: options.location,
                entities: options.entities || [],
                importance: options.importance || 5,
                agentName: this.agentName,
                pointers: options.pointers || []
            });

            return memoryId;
        } catch (error) {
            console.error('[MemorySystem] Failed to remember:', error.message);
            return null;
        }
    }

    /**
     * Recall relevant experiences (Episodic)
     */
    async recall(query, options = {}) {
        if (!this.initialized) return [];

        try {
            const queryEmbedding = await this.embeddings.embed(query);
            return await this.episodic.retrieveMemories(queryEmbedding, {
                k: options.k || 5,
                agentName: this.agentName
            });
        } catch (error) {
            console.error('[MemorySystem] Failed to recall:', error.message);
            return [];
        }
    }

    // ==================== Working Memory Operations ====================

    /**
     * Update working memory with current context
     */
    async updateContext(context) {
        if (!this.initialized) return;

        try {
            if (context.goal) {
                await this.working.setCurrentGoal(context.goal, context.goalPriority || 5);
            }

            if (context.attention) {
                await this.working.setAttention(context.attention, context.attentionType || 'entity');
            }

            if (context.gameState) {
                await this.working.setGameState(context.gameState);
            }

            if (context.playerName && context.playerContext) {
                await this.working.setPlayerContext(context.playerName, context.playerContext);
            }
        } catch (error) {
            console.error('[MemorySystem] Failed to update context:', error.message);
        }
    }

    /**
     * Add a message to the conversation buffer
     */
    async addMessage(sender, content, type = 'chat') {
        if (!this.initialized) return;

        try {
            await this.working.addMessage(sender, content, type);

            // Store significant messages as episodic memories
            if (content.length > 20 && type === 'chat') {
                await this.remember(
                    `${sender} said: "${content}"`,
                    {
                        type: 'conversation',
                        entities: [sender, this.agentName],
                        importance: this.calculateImportance(content)
                    }
                );
            }
        } catch (error) {
            console.error('[MemorySystem] Failed to add message:', error.message);
        }
    }

    // ==================== Semantic Memory Operations ====================

    /**
     * Learn a recipe
     */
    async learnRecipe(item, recipe) {
        if (!this.semantic?.connected) return false;
        return await this.semantic.learnRecipe(item, recipe);
    }

    /**
     * Get recipe for an item
     */
    async getRecipe(item) {
        if (!this.semantic?.connected) return null;
        return await this.semantic.getRecipe(item);
    }

    /**
     * Learn about a mob's behavior
     */
    async learnMobBehavior(mobType, behavior) {
        if (!this.semantic?.connected) return false;
        return await this.semantic.learnMobBehavior(mobType, behavior);
    }

    /**
     * Update player relationship
     */
    async updatePlayerRelation(playerName, relation) {
        if (!this.semantic?.connected) return false;
        return await this.semantic.updatePlayerRelation(playerName, relation);
    }

    /**
     * Get player relationship
     */
    async getPlayerRelation(playerName) {
        if (!this.semantic?.connected) return null;
        return await this.semantic.getPlayerRelation(playerName);
    }

    /**
     * Remember a named location
     */
    async rememberLocation(name, location) {
        if (!this.semantic?.connected) return false;
        return await this.semantic.rememberLocation(name, location);
    }

    /**
     * Get a location by name
     */
    async getLocation(name) {
        if (!this.semantic?.connected) return null;
        return await this.semantic.getLocation(name);
    }

    /**
     * Learn a general fact about the world
     */
    async learnFact(category, fact) {
        if (!this.semantic?.connected) return false;
        return await this.semantic.learnFact(category, fact);
    }

    // ==================== Procedural Memory Operations ====================

    /**
     * Find relevant skills for a task
     */
    async findSkills(taskDescription, options = {}) {
        if (!this.procedural?.initialized) return [];
        return await this.procedural.findSkills(taskDescription, options);
    }

    /**
     * Store a new skill
     */
    async storeSkill(skill) {
        if (!this.procedural?.initialized) return null;
        return await this.procedural.storeSkill(skill);
    }

    /**
     * Get a skill by name
     */
    async getSkill(name) {
        if (!this.procedural?.initialized) return null;
        return await this.procedural.getSkill(name);
    }

    /**
     * Record skill execution result
     */
    async recordSkillExecution(skillName, success, executionTime = 0) {
        if (!this.procedural?.initialized) return;
        await this.procedural.recordExecution(skillName, success, executionTime);
    }

    /**
     * Learn a skill from successful action
     */
    async learnSkill(name, description, code, preconditions = []) {
        if (!this.procedural?.initialized) return null;
        return await this.procedural.learnFromSuccess(name, description, code, preconditions);
    }

    // ==================== Combined Context ====================

    /**
     * Get comprehensive context for prompt generation
     */
    async getPromptContext(currentSituation = '') {
        if (!this.initialized) {
            return {
                episodicMemories: '',
                workingContext: '',
                semanticKnowledge: '',
                relevantSkills: ''
            };
        }

        try {
            // Get all memory types in parallel
            const [episodicResult, workingContext, semanticContext, relevantSkills] = await Promise.all([
                this.recall(currentSituation, { k: 5 }),
                this.working.getContextSummary(),
                this.semantic?.connected ? this.semantic.formatForPrompt(['relations', 'locations']) : '',
                this.procedural?.initialized ? this.procedural.findSkills(currentSituation, { k: 3 }) : []
            ]);

            // Format episodic memories
            const episodicFormatted = this.episodic.formatForPrompt(episodicResult);

            // Format working memory
            let workingFormatted = '';
            if (workingContext.currentGoal) {
                workingFormatted += `Current Goal: ${workingContext.currentGoal.goal}\n`;
            }
            if (workingContext.attention) {
                workingFormatted += `Focusing on: ${workingContext.attention.target}\n`;
            }
            if (workingContext.gameState) {
                const gs = workingContext.gameState;
                workingFormatted += `State: HP ${gs.health?.toFixed(1)}/20, Food ${gs.food}/20\n`;
            }

            // Format skills
            const skillsFormatted = relevantSkills.length > 0
                ? this.procedural.formatForPrompt(relevantSkills, 3)
                : '';

            return {
                episodicMemories: episodicFormatted,
                workingContext: workingFormatted,
                semanticKnowledge: semanticContext || '',
                relevantSkills: skillsFormatted,
                rawMemories: episodicResult,
                rawContext: workingContext,
                rawSkills: relevantSkills
            };
        } catch (error) {
            console.error('[MemorySystem] Failed to get prompt context:', error.message);
            return {
                episodicMemories: '',
                workingContext: '',
                semanticKnowledge: '',
                relevantSkills: ''
            };
        }
    }

    // ==================== Utilities ====================

    /**
     * Calculate importance score for a memory
     */
    calculateImportance(content) {
        let score = 5;

        const highImportance = ['help', 'important', 'remember', 'danger', 'diamond', 'build', 'friend', 'base', 'home'];
        const lowImportance = ['ok', 'yes', 'no', 'hi', 'hello', 'bye'];

        const lowerContent = content.toLowerCase();

        for (const word of highImportance) {
            if (lowerContent.includes(word)) score += 1;
        }

        for (const word of lowImportance) {
            if (lowerContent.includes(word)) score -= 1;
        }

        if (content.length > 100) score += 1;
        if (content.length > 200) score += 1;

        return Math.max(1, Math.min(10, score));
    }

    /**
     * Get comprehensive system statistics
     */
    async getStats() {
        const [episodicStats, semanticStats, proceduralStats] = await Promise.all([
            this.episodic.getStats(),
            this.semantic?.connected ? this.semantic.getStats() : null,
            this.procedural?.initialized ? this.procedural.getStats() : null
        ]);

        return {
            initialized: this.initialized,
            agentName: this.agentName,
            episodic: episodicStats,
            semantic: semanticStats,
            procedural: proceduralStats,
            embeddingsCacheSize: this.embeddings.cache.size
        };
    }

    /**
     * Cleanup and disconnect all components
     */
    async shutdown() {
        console.log('[MemorySystem] Shutting down all components...');

        await Promise.all([
            this.working.disconnect(),
            this.semantic?.disconnect()
        ]);

        this.initialized = false;
        console.log('[MemorySystem] Shutdown complete');
    }
}

// Export all components
export { EpisodicMemory } from './episodic_memory.js';
export { WorkingMemory } from './working_memory.js';
export { EmbeddingsGenerator } from './embeddings.js';
export { SemanticMemory } from './semantic_memory.js';
export { ProceduralMemory } from './procedural_memory.js';
export default PersistentMemorySystem;
