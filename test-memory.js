/**
 * Test script for Persistent Memory System
 * Verifies Qdrant and Redis connections and memory persistence
 */

import { PersistentMemorySystem } from './src/memory/index.js';

const config = {
    agentName: 'Andy',
    qdrantHost: process.env.QDRANT_HOST || '10.108.195.33',
    qdrantPort: process.env.QDRANT_PORT || '6333',
    redisHost: process.env.REDIS_HOST || '10.107.152.7',
    redisPort: process.env.REDIS_PORT || '6379',
    geminiApiKey: process.env.GEMINI_API_KEY || 'AIzaSyBJroTxr2iN8yXbx_jhPomgKrMGSmTZLwU'
};

async function runTests() {
    console.log('=== Memory System Test ===\n');
    console.log('Configuration:');
    console.log(`  Qdrant: ${config.qdrantHost}:${config.qdrantPort}`);
    console.log(`  Redis: ${config.redisHost}:${config.redisPort}`);
    console.log(`  Agent: ${config.agentName}\n`);

    const memory = new PersistentMemorySystem(config);

    try {
        // Test 1: Initialize
        console.log('Test 1: Initializing memory system...');
        const initOk = await memory.initialize();
        if (!initOk) {
            console.error('FAILED: Could not initialize memory system');
            process.exit(1);
        }
        console.log('PASSED: Memory system initialized\n');

        // Test 2: Store a memory
        console.log('Test 2: Storing test memory...');
        const testMemory = 'I found diamonds at coordinates 45, 12, -89 in a deep cave';
        const memoryId = await memory.remember(testMemory, {
            type: 'discovery',
            importance: 9,
            location: { x: 45, y: 12, z: -89 }
        });

        if (!memoryId) {
            console.error('FAILED: Could not store memory');
            process.exit(1);
        }
        console.log(`PASSED: Memory stored with ID: ${memoryId}\n`);

        // Test 3: Store another memory
        console.log('Test 3: Storing second memory...');
        const testMemory2 = 'Player Steve asked me to help build a house near the river';
        const memoryId2 = await memory.remember(testMemory2, {
            type: 'conversation',
            importance: 7,
            entities: ['Steve', 'Andy']
        });
        console.log(`PASSED: Second memory stored with ID: ${memoryId2}\n`);

        // Wait for Qdrant to index
        console.log('Waiting for Qdrant indexing...');
        await new Promise(r => setTimeout(r, 1000));

        // Test 4: Retrieve memories
        console.log('Test 4: Retrieving memories with query "diamonds"...');
        const retrieved = await memory.recall('Where are the diamonds?', { k: 5 });
        console.log(`Retrieved ${retrieved.length} memories:`);
        for (const mem of retrieved) {
            console.log(`  - [${mem.score?.toFixed(3)}] ${mem.description?.substring(0, 60)}...`);
        }

        if (retrieved.length === 0) {
            console.error('FAILED: No memories retrieved');
            process.exit(1);
        }
        console.log('PASSED: Memories retrieved successfully\n');

        // Test 5: Get stats
        console.log('Test 5: Getting system stats...');
        const stats = await memory.getStats();
        console.log(`Stats:`, JSON.stringify(stats, null, 2));
        console.log('PASSED: Stats retrieved\n');

        // Test 6: Get prompt context
        console.log('Test 6: Getting prompt context...');
        const context = await memory.getPromptContext('I need to find valuable ores');
        console.log('Prompt context:');
        console.log(context.episodicMemories || 'No episodic memories formatted');
        console.log('PASSED: Prompt context retrieved\n');

        console.log('=== All tests passed! ===');
        console.log('\nNow restart the bot and verify memories persist.\n');

        await memory.shutdown();
        process.exit(0);

    } catch (error) {
        console.error('TEST ERROR:', error);
        process.exit(1);
    }
}

runTests();
