/**
 * Procedural Memory System - Dynamic Skill Library
 * Stores learned skills as executable JavaScript code
 * Based on Voyager's skill library concept
 *
 * Each skill includes:
 * - Name and description
 * - Executable code
 * - Preconditions (what's needed to run the skill)
 * - Success metrics
 * - Embedding for semantic retrieval
 */

export class ProceduralMemory {
    constructor(config = {}) {
        this.qdrantHost = config.qdrantHost || process.env.QDRANT_HOST || 'qdrant.minecraft-ai.svc.cluster.local';
        this.qdrantPort = config.qdrantPort || process.env.QDRANT_PORT || 6333;
        this.collectionName = config.collectionName || 'agent_skills';
        this.vectorSize = 384;
        this.baseUrl = `http://${this.qdrantHost}:${this.qdrantPort}`;
        this.agentName = config.agentName || 'Andy';
        this.initialized = false;

        // Embeddings generator reference (passed from parent)
        this.embeddings = config.embeddingsGenerator || null;
    }

    async initialize() {
        try {
            // Check if collection exists
            const response = await fetch(`${this.baseUrl}/collections/${this.collectionName}`);

            if (response.status === 404) {
                await this.createCollection();
            }

            this.initialized = true;
            console.log(`[ProceduralMemory] Connected to Qdrant skills collection`);
            return true;
        } catch (error) {
            console.error('[ProceduralMemory] Failed to initialize:', error.message);
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
            throw new Error(`Failed to create skills collection: ${response.statusText}`);
        }

        console.log(`[ProceduralMemory] Created collection: ${this.collectionName}`);
    }

    /**
     * Store a new skill in the library
     */
    async storeSkill(skill) {
        if (!this.initialized) await this.initialize();

        // Generate embedding for skill description
        let embedding;
        if (this.embeddings) {
            embedding = await this.embeddings.embed(
                `${skill.name}: ${skill.description}. Preconditions: ${skill.preconditions?.join(', ') || 'none'}`
            );
        } else {
            // Fallback - simple hash-based embedding
            embedding = this._fallbackEmbed(skill.name + skill.description);
        }

        const skillId = this._generateSkillId(skill.name);
        const timestamp = new Date().toISOString();

        const point = {
            id: skillId,
            vector: embedding,
            payload: {
                name: skill.name,
                description: skill.description,
                code: skill.code,
                preconditions: skill.preconditions || [],
                postconditions: skill.postconditions || [],
                parameters: skill.parameters || [],
                examples: skill.examples || [],
                category: skill.category || 'general',
                complexity: skill.complexity || 'medium', // simple, medium, complex
                successCount: 0,
                failCount: 0,
                avgExecutionTime: 0,
                agent: this.agentName,
                createdAt: timestamp,
                updatedAt: timestamp,
                lastUsed: null,
                verified: false // Set to true after successful execution
            }
        };

        try {
            const response = await fetch(`${this.baseUrl}/collections/${this.collectionName}/points`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ points: [point] })
            });

            if (!response.ok) {
                throw new Error(`Failed to store skill: ${response.statusText}`);
            }

            console.log(`[ProceduralMemory] Stored skill: ${skill.name}`);
            return skillId;
        } catch (error) {
            console.error('[ProceduralMemory] Failed to store skill:', error.message);
            return null;
        }
    }

    /**
     * Find skills relevant to a task description
     */
    async findSkills(taskDescription, options = {}) {
        if (!this.initialized) await this.initialize();

        const k = options.k || 5;
        const minScore = options.minScore || 0.5;

        // Generate embedding for task
        let queryEmbedding;
        if (this.embeddings) {
            queryEmbedding = await this.embeddings.embed(taskDescription);
        } else {
            queryEmbedding = this._fallbackEmbed(taskDescription);
        }

        try {
            const response = await fetch(`${this.baseUrl}/collections/${this.collectionName}/points/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vector: queryEmbedding,
                    limit: k,
                    with_payload: true,
                    filter: {
                        must: [
                            { key: "agent", match: { value: this.agentName } }
                        ]
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Search failed: ${response.statusText}`);
            }

            const data = await response.json();
            const results = (data.result || [])
                .filter(r => r.score >= minScore)
                .map(r => ({
                    ...r.payload,
                    relevance: r.score,
                    id: r.id
                }));

            return results;
        } catch (error) {
            console.error('[ProceduralMemory] Failed to find skills:', error.message);
            return [];
        }
    }

    /**
     * Get skill by name
     */
    async getSkill(name) {
        if (!this.initialized) await this.initialize();

        const skillId = this._generateSkillId(name);

        try {
            const response = await fetch(`${this.baseUrl}/collections/${this.collectionName}/points/${skillId}`);

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            return data.result?.payload || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Record skill execution result
     */
    async recordExecution(skillName, success, executionTime = 0) {
        if (!this.initialized) await this.initialize();

        const skillId = this._generateSkillId(skillName);

        try {
            // Get current skill data
            const response = await fetch(`${this.baseUrl}/collections/${this.collectionName}/points/${skillId}`);

            if (!response.ok) return;

            const data = await response.json();
            const payload = data.result?.payload;
            if (!payload) return;

            // Calculate new average execution time
            const totalExecutions = payload.successCount + payload.failCount;
            const newAvg = totalExecutions > 0
                ? (payload.avgExecutionTime * totalExecutions + executionTime) / (totalExecutions + 1)
                : executionTime;

            // Update payload
            const updatePayload = {
                lastUsed: new Date().toISOString(),
                avgExecutionTime: newAvg,
                updatedAt: new Date().toISOString()
            };

            if (success) {
                updatePayload.successCount = payload.successCount + 1;
                updatePayload.verified = true; // Mark as verified after first success
            } else {
                updatePayload.failCount = payload.failCount + 1;
            }

            await fetch(`${this.baseUrl}/collections/${this.collectionName}/points/payload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    points: [skillId],
                    payload: updatePayload
                })
            });

            console.log(`[ProceduralMemory] Recorded ${success ? 'success' : 'failure'} for skill: ${skillName}`);
        } catch (error) {
            // Silent fail for metrics
        }
    }

    /**
     * Get all skills, optionally filtered by category
     */
    async getAllSkills(category = null) {
        if (!this.initialized) await this.initialize();

        try {
            const filter = {
                must: [
                    { key: "agent", match: { value: this.agentName } }
                ]
            };

            if (category) {
                filter.must.push({ key: "category", match: { value: category } });
            }

            const response = await fetch(`${this.baseUrl}/collections/${this.collectionName}/points/scroll`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filter: filter,
                    limit: 100,
                    with_payload: true
                })
            });

            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            return (data.result?.points || []).map(p => p.payload);
        } catch (error) {
            return [];
        }
    }

    /**
     * Get most successful skills
     */
    async getTopSkills(limit = 10) {
        const skills = await this.getAllSkills();

        // Sort by success rate and usage
        return skills
            .map(s => ({
                ...s,
                successRate: s.successCount + s.failCount > 0
                    ? s.successCount / (s.successCount + s.failCount)
                    : 0,
                totalUses: s.successCount + s.failCount
            }))
            .sort((a, b) => {
                // Prioritize verified skills with high success rate
                if (a.verified !== b.verified) return b.verified ? 1 : -1;
                if (a.successRate !== b.successRate) return b.successRate - a.successRate;
                return b.totalUses - a.totalUses;
            })
            .slice(0, limit);
    }

    /**
     * Delete a skill
     */
    async deleteSkill(name) {
        if (!this.initialized) await this.initialize();

        const skillId = this._generateSkillId(name);

        try {
            await fetch(`${this.baseUrl}/collections/${this.collectionName}/points/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    points: [skillId]
                })
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Generate deterministic skill ID from name
     */
    _generateSkillId(name) {
        // Create a simple hash from the skill name
        let hash = 0;
        const str = `${this.agentName}:${name.toLowerCase().replace(/\s+/g, '_')}`;

        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }

        return Math.abs(hash).toString();
    }

    /**
     * Fallback embedding using simple hash
     */
    _fallbackEmbed(text) {
        const embedding = new Array(this.vectorSize).fill(0);
        const normalized = text.toLowerCase().trim();

        for (let i = 0; i < normalized.length; i++) {
            const charCode = normalized.charCodeAt(i);
            const idx = (charCode * (i + 1)) % this.vectorSize;
            embedding[idx] += 1 / (normalized.length + 1);
        }

        // Normalize
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        if (magnitude > 0) {
            for (let i = 0; i < embedding.length; i++) {
                embedding[i] /= magnitude;
            }
        }

        return embedding;
    }

    /**
     * Get statistics
     */
    async getStats() {
        if (!this.initialized) await this.initialize();

        try {
            const response = await fetch(`${this.baseUrl}/collections/${this.collectionName}`);
            if (!response.ok) return null;

            const data = await response.json();
            const skills = await this.getAllSkills();

            const verified = skills.filter(s => s.verified).length;
            const totalExecutions = skills.reduce((sum, s) => sum + s.successCount + s.failCount, 0);

            return {
                totalSkills: data.result?.points_count || 0,
                verifiedSkills: verified,
                totalExecutions: totalExecutions,
                categories: [...new Set(skills.map(s => s.category))]
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * Format skills for prompt injection
     */
    formatForPrompt(skills, maxSkills = 5) {
        if (!skills || skills.length === 0) {
            return "No relevant skills found.";
        }

        return skills.slice(0, maxSkills).map((s, i) => {
            const successRate = s.successCount + s.failCount > 0
                ? Math.round(100 * s.successCount / (s.successCount + s.failCount))
                : 0;

            return `[${i + 1}] ${s.name} (${successRate}% success): ${s.description}
   Preconditions: ${s.preconditions?.join(', ') || 'none'}
   Code hint: ${s.code?.substring(0, 100)}...`;
        }).join('\n\n');
    }

    /**
     * Learn a skill from a successful action sequence
     * This is called when the agent successfully completes a novel task
     */
    async learnFromSuccess(name, description, code, preconditions = [], category = 'learned') {
        // Check if skill already exists
        const existing = await this.getSkill(name);
        if (existing) {
            // Just record success
            await this.recordExecution(name, true);
            return existing;
        }

        // Create new skill
        const skill = {
            name: name,
            description: description,
            code: code,
            preconditions: preconditions,
            category: category,
            complexity: code.length > 500 ? 'complex' : code.length > 200 ? 'medium' : 'simple'
        };

        await this.storeSkill(skill);
        return skill;
    }
}

export default ProceduralMemory;
