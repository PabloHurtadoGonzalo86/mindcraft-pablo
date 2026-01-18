/**
 * Semantic Memory System using MongoDB
 * Stores general knowledge: recipes, mob behaviors, player relationships, world knowledge
 * This is the "facts" memory - what the agent knows about the world
 */

import { MongoClient } from 'mongodb';

export class SemanticMemory {
    constructor(config = {}) {
        // Debug: log incoming config
        console.log('[SemanticMemory] Config received:', {
            mongoHost: config.mongoHost,
            envHost: process.env.MONGO_HOST
        });

        this.mongoHost = config.mongoHost || process.env.MONGO_HOST || '10.103.13.167';
        this.mongoPort = config.mongoPort || process.env.MONGO_PORT || 27017;
        this.mongoUser = config.mongoUser || process.env.MONGO_USER || 'mindcraft';
        this.mongoPassword = config.mongoPassword || process.env.MONGO_PASSWORD || 'mindcraft_user_2026';
        this.dbName = config.dbName || 'mindcraft';
        this.agentName = config.agentName || 'Andy';

        console.log(`[SemanticMemory] Will connect to: ${this.mongoHost}:${this.mongoPort}`);

        this.client = null;
        this.db = null;
        this.connected = false;

        // Collection names
        this.collections = {
            recipes: 'recipes',
            mobBehaviors: 'mob_behaviors',
            playerRelations: 'player_relations',
            locations: 'locations',
            facts: 'world_facts'
        };
    }

    async connect() {
        if (this.connected) return true;

        try {
            const uri = `mongodb://${this.mongoUser}:${this.mongoPassword}@${this.mongoHost}:${this.mongoPort}/${this.dbName}?authSource=${this.dbName}`;

            this.client = new MongoClient(uri);
            await this.client.connect();

            this.db = this.client.db(this.dbName);
            this.connected = true;

            // Create indexes for efficient querying
            await this._createIndexes();

            console.log(`[SemanticMemory] Connected to MongoDB at ${this.mongoHost}:${this.mongoPort}`);
            return true;
        } catch (error) {
            console.error('[SemanticMemory] Failed to connect:', error.message);
            return false;
        }
    }

    async _createIndexes() {
        try {
            // Recipes index
            await this.db.collection(this.collections.recipes).createIndex(
                { item: 1, agent: 1 }, { unique: true }
            );

            // Mob behaviors index
            await this.db.collection(this.collections.mobBehaviors).createIndex(
                { mobType: 1, agent: 1 }, { unique: true }
            );

            // Player relations index
            await this.db.collection(this.collections.playerRelations).createIndex(
                { playerName: 1, agent: 1 }, { unique: true }
            );

            // Locations index
            await this.db.collection(this.collections.locations).createIndex(
                { name: 1, agent: 1 }, { unique: true }
            );

            // Facts index
            await this.db.collection(this.collections.facts).createIndex(
                { category: 1, agent: 1 }
            );
        } catch (error) {
            // Indexes might already exist, that's fine
        }
    }

    async disconnect() {
        if (this.client && this.connected) {
            await this.client.close();
            this.connected = false;
            console.log('[SemanticMemory] Disconnected from MongoDB');
        }
    }

    // ==================== Recipe Knowledge ====================

    /**
     * Store or update a recipe the agent has learned
     */
    async learnRecipe(item, recipe) {
        if (!this.connected) await this.connect();

        const doc = {
            item: item,
            agent: this.agentName,
            ingredients: recipe.ingredients || [],
            craftingTable: recipe.requiresCraftingTable || false,
            furnace: recipe.requiresFurnace || false,
            notes: recipe.notes || '',
            successCount: 0,
            failCount: 0,
            lastUsed: null,
            updatedAt: new Date()
        };

        try {
            await this.db.collection(this.collections.recipes).updateOne(
                { item: item, agent: this.agentName },
                { $set: doc, $setOnInsert: { learnedAt: new Date() } },
                { upsert: true }
            );
            console.log(`[SemanticMemory] Learned recipe for: ${item}`);
            return true;
        } catch (error) {
            console.error('[SemanticMemory] Failed to learn recipe:', error.message);
            return false;
        }
    }

    /**
     * Record a recipe attempt result
     */
    async recordRecipeAttempt(item, success) {
        if (!this.connected) await this.connect();

        const update = success
            ? { $inc: { successCount: 1 }, $set: { lastUsed: new Date() } }
            : { $inc: { failCount: 1 }, $set: { lastUsed: new Date() } };

        try {
            await this.db.collection(this.collections.recipes).updateOne(
                { item: item, agent: this.agentName },
                update
            );
        } catch (error) {
            // Silent fail for metrics
        }
    }

    /**
     * Get recipe for an item
     */
    async getRecipe(item) {
        if (!this.connected) await this.connect();

        try {
            return await this.db.collection(this.collections.recipes).findOne({
                item: item,
                agent: this.agentName
            });
        } catch (error) {
            return null;
        }
    }

    /**
     * Get all known recipes
     */
    async getAllRecipes() {
        if (!this.connected) await this.connect();

        try {
            return await this.db.collection(this.collections.recipes)
                .find({ agent: this.agentName })
                .toArray();
        } catch (error) {
            return [];
        }
    }

    // ==================== Mob Behavior Knowledge ====================

    /**
     * Store or update mob behavior knowledge
     */
    async learnMobBehavior(mobType, behavior) {
        if (!this.connected) await this.connect();

        const doc = {
            mobType: mobType,
            agent: this.agentName,
            hostile: behavior.hostile || false,
            neutral: behavior.neutral || false,
            passive: behavior.passive || false,
            drops: behavior.drops || [],
            weaknesses: behavior.weaknesses || [],
            strengths: behavior.strengths || [],
            spawnConditions: behavior.spawnConditions || '',
            notes: behavior.notes || '',
            encounters: 0,
            kills: 0,
            deathsBy: 0,
            updatedAt: new Date()
        };

        try {
            await this.db.collection(this.collections.mobBehaviors).updateOne(
                { mobType: mobType, agent: this.agentName },
                { $set: doc },
                { upsert: true }
            );
            console.log(`[SemanticMemory] Learned behavior for: ${mobType}`);
            return true;
        } catch (error) {
            console.error('[SemanticMemory] Failed to learn mob behavior:', error.message);
            return false;
        }
    }

    /**
     * Record mob encounter
     */
    async recordMobEncounter(mobType, outcome) {
        if (!this.connected) await this.connect();

        let update = { $inc: { encounters: 1 }, $set: { updatedAt: new Date() } };

        if (outcome === 'killed') {
            update.$inc.kills = 1;
        } else if (outcome === 'died') {
            update.$inc.deathsBy = 1;
        }

        try {
            await this.db.collection(this.collections.mobBehaviors).updateOne(
                { mobType: mobType, agent: this.agentName },
                update
            );
        } catch (error) {
            // Silent fail
        }
    }

    /**
     * Get mob behavior
     */
    async getMobBehavior(mobType) {
        if (!this.connected) await this.connect();

        try {
            return await this.db.collection(this.collections.mobBehaviors).findOne({
                mobType: mobType,
                agent: this.agentName
            });
        } catch (error) {
            return null;
        }
    }

    // ==================== Player Relationships ====================

    /**
     * Update relationship with a player
     */
    async updatePlayerRelation(playerName, relation) {
        if (!this.connected) await this.connect();

        const doc = {
            playerName: playerName,
            agent: this.agentName,
            trust: relation.trust || 5, // 1-10 scale
            friendliness: relation.friendliness || 5,
            helpfulness: relation.helpfulness || 5,
            interactionCount: 0,
            lastInteraction: new Date(),
            notes: relation.notes || '',
            tags: relation.tags || [], // e.g., ['builder', 'friend', 'enemy']
            sharedActivities: relation.sharedActivities || [],
            updatedAt: new Date()
        };

        try {
            await this.db.collection(this.collections.playerRelations).updateOne(
                { playerName: playerName, agent: this.agentName },
                {
                    $set: {
                        trust: doc.trust,
                        friendliness: doc.friendliness,
                        helpfulness: doc.helpfulness,
                        notes: doc.notes,
                        tags: doc.tags,
                        updatedAt: new Date()
                    },
                    $inc: { interactionCount: 1 },
                    $setOnInsert: {
                        playerName: playerName,
                        agent: this.agentName,
                        sharedActivities: []
                    }
                },
                { upsert: true }
            );
            return true;
        } catch (error) {
            console.error('[SemanticMemory] Failed to update player relation:', error.message);
            return false;
        }
    }

    /**
     * Get player relationship
     */
    async getPlayerRelation(playerName) {
        if (!this.connected) await this.connect();

        try {
            return await this.db.collection(this.collections.playerRelations).findOne({
                playerName: playerName,
                agent: this.agentName
            });
        } catch (error) {
            return null;
        }
    }

    /**
     * Get all player relationships
     */
    async getAllPlayerRelations() {
        if (!this.connected) await this.connect();

        try {
            return await this.db.collection(this.collections.playerRelations)
                .find({ agent: this.agentName })
                .sort({ trust: -1 })
                .toArray();
        } catch (error) {
            return [];
        }
    }

    // ==================== Location Knowledge ====================

    /**
     * Store a named location
     */
    async rememberLocation(name, location) {
        if (!this.connected) await this.connect();

        const doc = {
            name: name,
            agent: this.agentName,
            x: location.x,
            y: location.y,
            z: location.z,
            dimension: location.dimension || 'overworld',
            biome: location.biome || 'unknown',
            description: location.description || '',
            tags: location.tags || [], // e.g., ['base', 'mine', 'danger']
            visitCount: 0,
            createdAt: new Date(),
            lastVisited: new Date()
        };

        try {
            await this.db.collection(this.collections.locations).updateOne(
                { name: name, agent: this.agentName },
                {
                    $set: doc,
                    $inc: { visitCount: 1 }
                },
                { upsert: true }
            );
            console.log(`[SemanticMemory] Remembered location: ${name} at ${location.x}, ${location.y}, ${location.z}`);
            return true;
        } catch (error) {
            console.error('[SemanticMemory] Failed to remember location:', error.message);
            return false;
        }
    }

    /**
     * Get a location by name
     */
    async getLocation(name) {
        if (!this.connected) await this.connect();

        try {
            return await this.db.collection(this.collections.locations).findOne({
                name: { $regex: new RegExp(name, 'i') },
                agent: this.agentName
            });
        } catch (error) {
            return null;
        }
    }

    /**
     * Get all known locations
     */
    async getAllLocations() {
        if (!this.connected) await this.connect();

        try {
            return await this.db.collection(this.collections.locations)
                .find({ agent: this.agentName })
                .sort({ visitCount: -1 })
                .toArray();
        } catch (error) {
            return [];
        }
    }

    /**
     * Find locations by tag
     */
    async getLocationsByTag(tag) {
        if (!this.connected) await this.connect();

        try {
            return await this.db.collection(this.collections.locations)
                .find({
                    agent: this.agentName,
                    tags: tag
                })
                .toArray();
        } catch (error) {
            return [];
        }
    }

    // ==================== General World Facts ====================

    /**
     * Store a general fact about the world
     */
    async learnFact(category, fact) {
        if (!this.connected) await this.connect();

        const doc = {
            agent: this.agentName,
            category: category, // e.g., 'mining', 'farming', 'combat', 'crafting'
            fact: fact,
            confidence: 1.0,
            source: 'experience',
            createdAt: new Date(),
            lastConfirmed: new Date()
        };

        try {
            // Check if similar fact exists
            const existing = await this.db.collection(this.collections.facts).findOne({
                agent: this.agentName,
                category: category,
                fact: fact
            });

            if (existing) {
                // Increase confidence
                await this.db.collection(this.collections.facts).updateOne(
                    { _id: existing._id },
                    {
                        $inc: { confidence: 0.1 },
                        $set: { lastConfirmed: new Date() }
                    }
                );
            } else {
                await this.db.collection(this.collections.facts).insertOne(doc);
                console.log(`[SemanticMemory] Learned fact [${category}]: ${fact.substring(0, 50)}...`);
            }
            return true;
        } catch (error) {
            console.error('[SemanticMemory] Failed to learn fact:', error.message);
            return false;
        }
    }

    /**
     * Get facts by category
     */
    async getFactsByCategory(category, limit = 10) {
        if (!this.connected) await this.connect();

        try {
            return await this.db.collection(this.collections.facts)
                .find({
                    agent: this.agentName,
                    category: category
                })
                .sort({ confidence: -1 })
                .limit(limit)
                .toArray();
        } catch (error) {
            return [];
        }
    }

    /**
     * Get all facts
     */
    async getAllFacts(limit = 50) {
        if (!this.connected) await this.connect();

        try {
            return await this.db.collection(this.collections.facts)
                .find({ agent: this.agentName })
                .sort({ confidence: -1, lastConfirmed: -1 })
                .limit(limit)
                .toArray();
        } catch (error) {
            return [];
        }
    }

    // ==================== Statistics ====================

    async getStats() {
        if (!this.connected) await this.connect();

        try {
            const [recipes, mobs, players, locations, facts] = await Promise.all([
                this.db.collection(this.collections.recipes).countDocuments({ agent: this.agentName }),
                this.db.collection(this.collections.mobBehaviors).countDocuments({ agent: this.agentName }),
                this.db.collection(this.collections.playerRelations).countDocuments({ agent: this.agentName }),
                this.db.collection(this.collections.locations).countDocuments({ agent: this.agentName }),
                this.db.collection(this.collections.facts).countDocuments({ agent: this.agentName })
            ]);

            return {
                recipes,
                mobBehaviors: mobs,
                playerRelations: players,
                locations,
                facts,
                total: recipes + mobs + players + locations + facts
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * Format semantic knowledge for prompt injection
     */
    async formatForPrompt(categories = ['all']) {
        if (!this.connected) await this.connect();

        let prompt = '';

        try {
            if (categories.includes('all') || categories.includes('relations')) {
                const relations = await this.getAllPlayerRelations();
                if (relations.length > 0) {
                    prompt += '## Player Relationships:\n';
                    relations.slice(0, 5).forEach(r => {
                        prompt += `- ${r.playerName}: Trust ${r.trust}/10, ${r.tags.join(', ') || 'no tags'}\n`;
                    });
                    prompt += '\n';
                }
            }

            if (categories.includes('all') || categories.includes('locations')) {
                const locations = await this.getAllLocations();
                if (locations.length > 0) {
                    prompt += '## Known Locations:\n';
                    locations.slice(0, 5).forEach(l => {
                        prompt += `- ${l.name}: ${l.x}, ${l.y}, ${l.z} (${l.dimension})\n`;
                    });
                    prompt += '\n';
                }
            }

            if (categories.includes('all') || categories.includes('facts')) {
                const facts = await this.getAllFacts(5);
                if (facts.length > 0) {
                    prompt += '## Known Facts:\n';
                    facts.forEach(f => {
                        prompt += `- [${f.category}] ${f.fact}\n`;
                    });
                    prompt += '\n';
                }
            }

            return prompt || 'No semantic knowledge stored yet.';
        } catch (error) {
            return 'Error retrieving semantic knowledge.';
        }
    }
}

export default SemanticMemory;
