/**
 * Episodic Memory System using Qdrant Vector Database
 * Stores and retrieves agent experiences with semantic search
 * Based on "Generative Agents" paper by Stanford
 */

import { v4 as uuidv4 } from 'uuid';

export class EpisodicMemory {
    constructor(config = {}) {
        this.qdrantHost = config.qdrantHost || process.env.QDRANT_HOST || 'qdrant.minecraft-ai.svc.cluster.local';
        this.qdrantPort = config.qdrantPort || process.env.QDRANT_PORT || 6333;
        this.collectionName = config.collectionName || 'agent_memories';
        this.vectorSize = 384; // Size for all-MiniLM-L6-v2 embeddings
        this.baseUrl = `http://${this.qdrantHost}:${this.qdrantPort}`;
        this.initialized = false;
    }

    async initialize() {
        try {
            // Check if collection exists, create if not
            const response = await fetch(`${this.baseUrl}/collections/${this.collectionName}`);

            if (response.status === 404) {
                await this.createCollection();
            }

            this.initialized = true;
            console.log(`[EpisodicMemory] Connected to Qdrant at ${this.baseUrl}`);
            return true;
        } catch (error) {
            console.error('[EpisodicMemory] Failed to initialize:', error.message);
            return false;
        }
    }

    async createCollection() {
        const config = {
            vectors: {
                size: this.vectorSize,
                distance: "Cosine"
            }
        };

        const response = await fetch(`${this.baseUrl}/collections/${this.collectionName}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        if (!response.ok) {
            throw new Error(`Failed to create collection: ${response.statusText}`);
        }

        console.log(`[EpisodicMemory] Created collection: ${this.collectionName}`);
    }

    /**
     * Store a new memory with embedding
     */
    async storeMemory(memory) {
        if (!this.initialized) await this.initialize();

        const memoryId = uuidv4();
        const timestamp = new Date().toISOString();

        const point = {
            id: memoryId,
            vector: memory.embedding,
            payload: {
                type: memory.type || 'observation',
                description: memory.description,
                timestamp: timestamp,
                game_time: memory.gameTime || 'unknown',
                location: memory.location || null,
                entities_involved: memory.entities || [],
                importance_score: memory.importance || 5,
                last_accessed: timestamp,
                access_count: 1,
                agent_name: memory.agentName || 'Andy',
                pointers: memory.pointers || []
            }
        };

        try {
            const response = await fetch(`${this.baseUrl}/collections/${this.collectionName}/points`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ points: [point] })
            });

            if (!response.ok) {
                throw new Error(`Failed to store memory: ${response.statusText}`);
            }

            console.log(`[EpisodicMemory] Stored memory: ${memory.description.substring(0, 50)}...`);
            return memoryId;
        } catch (error) {
            console.error('[EpisodicMemory] Failed to store memory:', error.message);
            return null;
        }
    }

    /**
     * Retrieve memories using the Generative Agents algorithm
     * Combines: recency, importance, and relevance
     */
    async retrieveMemories(queryEmbedding, options = {}) {
        if (!this.initialized) await this.initialize();

        const k = options.k || 10;
        const agentName = options.agentName || 'Andy';

        try {
            // Search by vector similarity
            const response = await fetch(`${this.baseUrl}/collections/${this.collectionName}/points/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vector: queryEmbedding,
                    limit: k * 2, // Get more to rerank
                    with_payload: true,
                    filter: {
                        must: [
                            { key: "agent_name", match: { value: agentName } }
                        ]
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Search failed: ${response.statusText}`);
            }

            const data = await response.json();
            const results = data.result || [];

            // Apply Generative Agents scoring
            const scoredMemories = results.map(result => {
                const payload = result.payload;
                const relevanceScore = result.score; // Cosine similarity from Qdrant

                // Recency: exponential decay
                const lastAccessed = new Date(payload.last_accessed);
                const hoursSinceAccess = (Date.now() - lastAccessed.getTime()) / (1000 * 60 * 60);
                const recencyScore = Math.pow(0.995, hoursSinceAccess);

                // Importance: normalized 1-10
                const importanceScore = (payload.importance_score || 5) / 10.0;

                // Combined score (equal weights)
                const finalScore = (recencyScore + importanceScore + relevanceScore) / 3;

                return {
                    id: result.id,
                    ...payload,
                    relevance: relevanceScore,
                    recency: recencyScore,
                    final_score: finalScore
                };
            });

            // Sort by final score and take top k
            scoredMemories.sort((a, b) => b.final_score - a.final_score);
            const topMemories = scoredMemories.slice(0, k);

            // Update access counts for retrieved memories
            await this.updateAccessCounts(topMemories.map(m => m.id));

            return topMemories;
        } catch (error) {
            console.error('[EpisodicMemory] Failed to retrieve memories:', error.message);
            return [];
        }
    }

    /**
     * Update access counts and last_accessed for retrieved memories
     */
    async updateAccessCounts(memoryIds) {
        const timestamp = new Date().toISOString();

        for (const id of memoryIds) {
            try {
                // Get current point
                const getResponse = await fetch(`${this.baseUrl}/collections/${this.collectionName}/points/${id}`);
                if (!getResponse.ok) continue;

                const pointData = await getResponse.json();
                const payload = pointData.result?.payload;
                if (!payload) continue;

                // Update payload
                await fetch(`${this.baseUrl}/collections/${this.collectionName}/points/payload`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        points: [id],
                        payload: {
                            last_accessed: timestamp,
                            access_count: (payload.access_count || 0) + 1
                        }
                    })
                });
            } catch (error) {
                // Silently fail for access count updates
            }
        }
    }

    /**
     * Get memory statistics
     */
    async getStats() {
        try {
            const response = await fetch(`${this.baseUrl}/collections/${this.collectionName}`);
            if (!response.ok) return null;

            const data = await response.json();
            return {
                vectorCount: data.result?.vectors_count || 0,
                pointsCount: data.result?.points_count || 0,
                segmentsCount: data.result?.segments_count || 0
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * Format memories for prompt injection
     */
    formatForPrompt(memories) {
        if (!memories || memories.length === 0) {
            return "No relevant memories found.";
        }

        return memories.map((m, i) => {
            const score = (m.final_score * 100).toFixed(1);
            return `[${i + 1}] (${score}%) ${m.description}`;
        }).join('\n');
    }
}

export default EpisodicMemory;
