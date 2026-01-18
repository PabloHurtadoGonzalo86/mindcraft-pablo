/**
 * Embeddings Generator for Memory System
 * Uses Google's text-embedding model for vector generation
 */

export class EmbeddingsGenerator {
    constructor(config = {}) {
        this.apiKey = config.apiKey || process.env.GEMINI_API_KEY;
        this.model = config.model || 'text-embedding-004';
        this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
        this.dimensions = 384; // Output dimension for the embedding
        this.cache = new Map(); // Simple in-memory cache
        this.maxCacheSize = 1000;
    }

    /**
     * Generate embedding for a single text
     */
    async embed(text) {
        if (!text || text.trim().length === 0) {
            return new Array(this.dimensions).fill(0);
        }

        // Check cache first
        const cacheKey = text.substring(0, 100);
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        try {
            const response = await fetch(
                `${this.baseUrl}/models/${this.model}:embedContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: `models/${this.model}`,
                        content: {
                            parts: [{ text: text }]
                        },
                        outputDimensionality: this.dimensions
                    })
                }
            );

            if (!response.ok) {
                const error = await response.text();
                console.error('[Embeddings] API error:', error);
                return this.fallbackEmbed(text);
            }

            const data = await response.json();
            const embedding = data.embedding?.values;

            if (!embedding) {
                console.error('[Embeddings] No embedding in response');
                return this.fallbackEmbed(text);
            }

            // Cache the result
            if (this.cache.size >= this.maxCacheSize) {
                // Remove oldest entry
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }
            this.cache.set(cacheKey, embedding);

            return embedding;
        } catch (error) {
            console.error('[Embeddings] Failed to generate:', error.message);
            return this.fallbackEmbed(text);
        }
    }

    /**
     * Generate embeddings for multiple texts (batch)
     */
    async embedBatch(texts) {
        const embeddings = await Promise.all(
            texts.map(text => this.embed(text))
        );
        return embeddings;
    }

    /**
     * Fallback embedding using simple hash-based method
     * Used when API is unavailable
     */
    fallbackEmbed(text) {
        const embedding = new Array(this.dimensions).fill(0);

        // Simple deterministic embedding based on character codes
        const normalized = text.toLowerCase().trim();
        for (let i = 0; i < normalized.length; i++) {
            const charCode = normalized.charCodeAt(i);
            const idx = (charCode * (i + 1)) % this.dimensions;
            embedding[idx] += 1 / (normalized.length + 1);
        }

        // Normalize the vector
        const magnitude = Math.sqrt(
            embedding.reduce((sum, val) => sum + val * val, 0)
        );

        if (magnitude > 0) {
            for (let i = 0; i < embedding.length; i++) {
                embedding[i] /= magnitude;
            }
        }

        return embedding;
    }

    /**
     * Calculate cosine similarity between two embeddings
     */
    cosineSimilarity(a, b) {
        if (a.length !== b.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }
}

export default EmbeddingsGenerator;
