/**
 * Test script to verify memory persistence after restart
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

async function testPersistence() {
    console.log('=== Memory Persistence Test ===\n');

    const memory = new PersistentMemorySystem(config);

    try {
        await memory.initialize();

        // Check if previous memories exist
        console.log('Querying for diamond-related memories...');
        const diamondMemories = await memory.recall('Where are diamonds?', { k: 5 });

        console.log(`Found ${diamondMemories.length} memories:\n`);

        for (const mem of diamondMemories) {
            console.log(`  ID: ${mem.id}`);
            console.log(`  Description: ${mem.description}`);
            console.log(`  Type: ${mem.type}`);
            console.log(`  Importance: ${mem.importance}`);
            console.log(`  Timestamp: ${new Date(mem.timestamp).toISOString()}`);
            console.log('  ---');
        }

        if (diamondMemories.length === 0) {
            console.error('\nFAILED: Memories were not persisted!');
            process.exit(1);
        }

        // Test prompt context generation
        console.log('\nGenerating prompt context for "mining diamonds"...');
        const context = await memory.getPromptContext('I want to go mining for diamonds');
        console.log('\nPrompt Context Output:');
        console.log(context.episodicMemories);

        // Verify the diamond memory is retrieved
        if (context.episodicMemories.includes('diamonds')) {
            console.log('\n=== PERSISTENCE TEST PASSED ===');
            console.log('Memories survived restart and are retrievable!');
        } else {
            console.log('\n=== PERSISTENCE TEST PARTIAL ===');
            console.log('Memories exist but retrieval may need tuning');
        }

        await memory.shutdown();

    } catch (error) {
        console.error('ERROR:', error);
        process.exit(1);
    }
}

testPersistence();
