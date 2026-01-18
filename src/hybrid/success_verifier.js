/**
 * Success Verifier - Verificación Inteligente de Objetivos
 *
 * Utiliza múltiples métodos para verificar si un objetivo se completó:
 * - Verificación de inventario
 * - Verificación de posición/dimensión
 * - Verificación de estructuras construidas
 * - Verificación de entidades cercanas
 * - Verificación basada en LLM (para tareas complejas)
 *
 * Integración con allow_vision para verificación visual
 */

export class SuccessVerifier {
    constructor(agent, config = {}) {
        this.agent = agent;
        this.bot = agent.bot;

        // Config
        this.useVision = config.useVision || false;
        this.useLLM = config.useLLM || true;
        this.strictMode = config.strictMode || false; // Si true, requiere verificación LLM

        // Cache de verificaciones
        this.verificationCache = new Map();
        this.cacheTimeout = 5000; // 5 segundos
    }

    /**
     * Verifica si un objetivo se completó
     * @param {Object} task - Tarea del curriculum
     * @param {Object} context - Contexto adicional (inventario previo, etc.)
     * @returns {Promise<{success: boolean, confidence: number, reason: string}>}
     */
    async verify(task, context = {}) {
        const results = [];

        // 1. Verificación básica (función verify del task)
        if (task.verify) {
            const inventory = this._getInventory();
            const basicResult = task.verify(inventory);
            results.push({
                method: 'basic',
                success: basicResult,
                confidence: basicResult ? 0.9 : 0.1,
                reason: basicResult ? 'Basic verification passed' : 'Basic verification failed'
            });
        }

        // 2. Verificación de inventario (cambios)
        if (context.previousInventory) {
            const invResult = this._verifyInventoryChange(task, context.previousInventory);
            results.push(invResult);
        }

        // 3. Verificación de categoría específica
        const categoryResult = await this._verifyCategorySpecific(task);
        if (categoryResult) {
            results.push(categoryResult);
        }

        // 4. Verificación visual (si está habilitada)
        if (this.useVision && this.agent.vision) {
            const visionResult = await this._verifyWithVision(task);
            if (visionResult) {
                results.push(visionResult);
            }
        }

        // 5. Verificación LLM (para tareas complejas o si strict mode)
        if (this.useLLM && (task.command.includes('!newAction') || this.strictMode)) {
            const llmResult = await this._verifyWithLLM(task);
            if (llmResult) {
                results.push(llmResult);
            }
        }

        // Calcular resultado final
        return this._aggregateResults(results, task);
    }

    /**
     * Obtiene el inventario actual
     */
    _getInventory() {
        const inventory = {};
        this.bot.inventory.items().forEach(item => {
            inventory[item.name] = (inventory[item.name] || 0) + item.count;
        });
        return inventory;
    }

    /**
     * Verifica cambios en el inventario
     */
    _verifyInventoryChange(task, previousInventory) {
        const currentInventory = this._getInventory();

        // Extraer items esperados del task
        const expectedItems = this._extractExpectedItems(task);

        if (expectedItems.length === 0) {
            return null;
        }

        let itemsGained = 0;
        let itemsExpected = 0;

        for (const expected of expectedItems) {
            itemsExpected++;
            const prevCount = previousInventory[expected.item] || 0;
            const currCount = currentInventory[expected.item] || 0;

            if (expected.count) {
                if (currCount >= expected.count) {
                    itemsGained++;
                }
            } else if (currCount > prevCount) {
                itemsGained++;
            }
        }

        const success = itemsGained === itemsExpected;
        const confidence = itemsExpected > 0 ? itemsGained / itemsExpected : 0;

        return {
            method: 'inventory_change',
            success,
            confidence,
            reason: `Gained ${itemsGained}/${itemsExpected} expected items`
        };
    }

    /**
     * Extrae items esperados de la descripción de la tarea
     */
    _extractExpectedItems(task) {
        const items = [];
        const text = `${task.name} ${task.description} ${task.command}`;

        // Patrones comunes
        const patterns = [
            /(\d+)\s+(\w+)/g,           // "16 oak_log"
            /obtain\s+(\d+)?\s*(\w+)/gi, // "obtain 5 diamonds"
            /get\s+(\d+)?\s*(\w+)/gi,    // "get iron_ore"
            /craft\s+(\d+)?\s*(\w+)/gi,  // "craft stone_pickaxe"
            /mine\s+(\d+)?\s*(\w+)/gi    // "mine cobblestone"
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const count = match[1] ? parseInt(match[1]) : 1;
                const item = match[2].toLowerCase();

                // Filtrar palabras comunes que no son items
                const excludeWords = ['the', 'a', 'an', 'to', 'for', 'with', 'and', 'or'];
                if (!excludeWords.includes(item)) {
                    items.push({ item, count });
                }
            }
        }

        return items;
    }

    /**
     * Verificación específica por categoría
     */
    async _verifyCategorySpecific(task) {
        switch (task.category) {
            case 'gathering':
                return this._verifyGathering(task);
            case 'crafting':
                return this._verifyCrafting(task);
            case 'building':
                return this._verifyBuilding(task);
            case 'combat':
                return this._verifyCombat(task);
            case 'exploration':
                return this._verifyExploration(task);
            case 'tools':
                return this._verifyTools(task);
            default:
                return null;
        }
    }

    _verifyGathering(task) {
        const inventory = this._getInventory();
        const totalItems = Object.values(inventory).reduce((sum, count) => sum + count, 0);

        return {
            method: 'category_gathering',
            success: totalItems > 0,
            confidence: Math.min(totalItems / 64, 1) * 0.5 + 0.5,
            reason: `Total items in inventory: ${totalItems}`
        };
    }

    _verifyCrafting(task) {
        // Verificar que se usó la mesa de crafteo recientemente
        const craftingTable = this.bot.findBlock({
            matching: block => block.name === 'crafting_table',
            maxDistance: 16
        });

        return {
            method: 'category_crafting',
            success: craftingTable !== null,
            confidence: craftingTable ? 0.7 : 0.3,
            reason: craftingTable ? 'Crafting table nearby' : 'No crafting table found'
        };
    }

    _verifyBuilding(task) {
        // Verificar cambios en bloques cercanos
        const position = this.bot.entity.position;
        let structureBlocks = 0;

        // Contar bloques colocados por el jugador en área cercana
        const radius = 10;
        for (let x = -radius; x <= radius; x++) {
            for (let y = -5; y <= 10; y++) {
                for (let z = -radius; z <= radius; z++) {
                    const block = this.bot.blockAt(position.offset(x, y, z));
                    if (block && !['air', 'water', 'lava', 'grass_block', 'dirt', 'stone'].includes(block.name)) {
                        structureBlocks++;
                    }
                }
            }
        }

        const success = structureBlocks > 10;
        return {
            method: 'category_building',
            success,
            confidence: Math.min(structureBlocks / 50, 1),
            reason: `Structure blocks nearby: ${structureBlocks}`
        };
    }

    _verifyCombat(task) {
        const inventory = this._getInventory();

        // Verificar armas/armadura
        const weapons = ['wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword', 'netherite_sword'];
        const armor = ['helmet', 'chestplate', 'leggings', 'boots'];

        const hasWeapon = weapons.some(w => inventory[w] > 0);
        const armorCount = armor.filter(a =>
            Object.keys(inventory).some(item => item.includes(a))
        ).length;

        return {
            method: 'category_combat',
            success: hasWeapon || armorCount > 0,
            confidence: (hasWeapon ? 0.5 : 0) + (armorCount / 4) * 0.5,
            reason: `Has weapon: ${hasWeapon}, Armor pieces: ${armorCount}`
        };
    }

    _verifyExploration(task) {
        const dimension = this.bot.game?.dimension || 'overworld';
        const position = this.bot.entity.position;

        let result = {
            method: 'category_exploration',
            success: false,
            confidence: 0.5,
            reason: `In ${dimension} at Y=${Math.round(position.y)}`
        };

        // Verificar dimensión específica
        if (task.name.toLowerCase().includes('nether') && dimension === 'the_nether') {
            result.success = true;
            result.confidence = 0.95;
        } else if (task.name.toLowerCase().includes('end') && dimension === 'the_end') {
            result.success = true;
            result.confidence = 0.95;
        } else if (task.name.toLowerCase().includes('stronghold') && position.y < 40) {
            result.success = true;
            result.confidence = 0.7;
        }

        return result;
    }

    _verifyTools(task) {
        const inventory = this._getInventory();

        const tools = [
            'pickaxe', 'axe', 'shovel', 'hoe', 'sword',
            'bucket', 'flint_and_steel', 'shield', 'bow', 'crossbow'
        ];

        const toolCount = tools.filter(t =>
            Object.keys(inventory).some(item => item.includes(t))
        ).length;

        return {
            method: 'category_tools',
            success: toolCount > 0,
            confidence: Math.min(toolCount / 5, 1),
            reason: `Tools in inventory: ${toolCount}`
        };
    }

    /**
     * Verificación con vision (screenshots)
     */
    async _verifyWithVision(task) {
        if (!this.agent.vision) return null;

        try {
            // Tomar screenshot
            const screenshot = await this.agent.vision.capture();
            if (!screenshot) return null;

            // Analizar con vision model
            const prompt = `Verify if this Minecraft screenshot shows completion of: "${task.name}".
                           Task description: ${task.description}
                           Respond with JSON: {"completed": true/false, "confidence": 0.0-1.0, "reason": "explanation"}`;

            const analysis = await this.agent.prompter.promptVision(prompt, screenshot);

            // Parsear respuesta
            const jsonMatch = analysis.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                return {
                    method: 'vision',
                    success: result.completed,
                    confidence: result.confidence || 0.5,
                    reason: result.reason || 'Vision analysis'
                };
            }
        } catch (error) {
            console.error('[SuccessVerifier] Vision verification failed:', error.message);
        }

        return null;
    }

    /**
     * Verificación con LLM
     */
    async _verifyWithLLM(task) {
        try {
            const inventory = this._getInventory();
            const position = this.bot.entity.position;
            const dimension = this.bot.game?.dimension || 'overworld';
            const health = this.bot.health;
            const food = this.bot.food;

            const prompt = `You are verifying if a Minecraft bot completed a task.

Task: ${task.name}
Description: ${task.description}
Command used: ${task.command}

Current state:
- Inventory: ${JSON.stringify(inventory)}
- Position: X=${Math.round(position.x)}, Y=${Math.round(position.y)}, Z=${Math.round(position.z)}
- Dimension: ${dimension}
- Health: ${health}/20
- Food: ${food}/20

Did the bot complete the task? Respond with ONLY a JSON object:
{"completed": true/false, "confidence": 0.0-1.0, "reason": "brief explanation"}`;

            const response = await this.agent.prompter.promptConvo([
                { role: 'user', content: prompt }
            ]);

            // Parsear respuesta
            const jsonMatch = response.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                return {
                    method: 'llm',
                    success: result.completed,
                    confidence: result.confidence || 0.5,
                    reason: result.reason || 'LLM verification'
                };
            }
        } catch (error) {
            console.error('[SuccessVerifier] LLM verification failed:', error.message);
        }

        return null;
    }

    /**
     * Agrega resultados de múltiples verificaciones
     */
    _aggregateResults(results, task) {
        if (results.length === 0) {
            return {
                success: false,
                confidence: 0,
                reason: 'No verification methods available',
                details: []
            };
        }

        // Pesos por método
        const weights = {
            basic: 1.0,
            inventory_change: 0.8,
            category_gathering: 0.5,
            category_crafting: 0.6,
            category_building: 0.7,
            category_combat: 0.6,
            category_exploration: 0.8,
            category_tools: 0.6,
            vision: 0.9,
            llm: 0.85
        };

        let totalWeight = 0;
        let weightedSuccess = 0;
        let weightedConfidence = 0;

        for (const result of results) {
            const weight = weights[result.method] || 0.5;
            totalWeight += weight;
            weightedSuccess += (result.success ? 1 : 0) * weight;
            weightedConfidence += result.confidence * weight;
        }

        const avgSuccess = totalWeight > 0 ? weightedSuccess / totalWeight : 0;
        const avgConfidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0;

        // Decisión final
        const success = avgSuccess >= 0.5 && avgConfidence >= 0.4;

        // Encontrar la razón más relevante
        const sortedResults = results.sort((a, b) =>
            (weights[b.method] || 0.5) * b.confidence -
            (weights[a.method] || 0.5) * a.confidence
        );

        return {
            success,
            confidence: avgConfidence,
            reason: sortedResults[0]?.reason || 'Unknown',
            details: results
        };
    }

    /**
     * Verificación rápida (solo básica + inventario)
     */
    quickVerify(task) {
        if (task.verify) {
            const inventory = this._getInventory();
            return task.verify(inventory);
        }
        return false;
    }
}

export default SuccessVerifier;
