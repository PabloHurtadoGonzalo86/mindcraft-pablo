/**
 * Curriculum Engine - Motor de Progresión Automática
 * Basado en Voyager (NVIDIA) adaptado para Mindcraft-CE
 *
 * Funcionalidades:
 * - Tech tree progresivo de Minecraft
 * - Propuesta automática de objetivos
 * - Tracking de progreso persistente
 * - Integración con ProceduralMemory para skills
 *
 * @see https://voyager.minedojo.org/
 * @see https://arxiv.org/abs/2305.16291
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

export class CurriculumEngine {
    constructor(agent, config = {}) {
        this.agent = agent;
        this.bot = agent.bot;

        // Config
        this.dataPath = config.dataPath || `./bots/${agent.name}/curriculum/`;
        this.warmupTasks = config.warmupTasks || 5;
        this.maxRetries = config.maxRetries || 3;
        this.taskTimeoutMs = config.taskTimeoutMs || 5 * 60 * 1000; // 5 minutos por tarea

        // State
        this.completedTasks = [];
        this.failedTasks = [];
        this.currentTask = null;
        this.taskAttempts = 0;
        this.isRunning = false;
        this.isPaused = false;

        // Minecraft Tech Tree - Progresión lógica
        this.techTree = this._buildTechTree();

        // Ensure data directory exists
        if (!existsSync(this.dataPath)) {
            mkdirSync(this.dataPath, { recursive: true });
        }

        // Load saved progress
        this._loadProgress();
    }

    /**
     * Construye el árbol tecnológico de Minecraft
     * Cada nodo tiene: id, name, prereqs, verifyFn, priority
     */
    _buildTechTree() {
        return [
            // === FASE 1: Supervivencia Básica (Warmup) ===
            {
                id: 'get_wood',
                name: 'Obtener 16 bloques de madera',
                description: 'Mine 16 oak_log, birch_log, or any wood type',
                prereqs: [],
                verify: (inv) => this._countItems(inv, ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log']) >= 16,
                command: '!collectBlocks("oak_log", 16)',
                priority: 100,
                category: 'gathering'
            },
            {
                id: 'craft_planks',
                name: 'Craftear 32 tablones de madera',
                description: 'Convert logs into planks',
                prereqs: ['get_wood'],
                verify: (inv) => this._countItems(inv, ['oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks']) >= 32,
                command: '!craftRecipe("oak_planks", 32)',
                priority: 95,
                category: 'crafting'
            },
            {
                id: 'craft_crafting_table',
                name: 'Craftear mesa de crafteo',
                description: 'Create a crafting table',
                prereqs: ['craft_planks'],
                verify: (inv) => this._hasItem(inv, 'crafting_table'),
                command: '!craftRecipe("crafting_table", 1)',
                priority: 94,
                category: 'crafting'
            },
            {
                id: 'craft_sticks',
                name: 'Craftear 16 palos',
                description: 'Create sticks for tools',
                prereqs: ['craft_planks'],
                verify: (inv) => inv['stick'] >= 16,
                command: '!craftRecipe("stick", 16)',
                priority: 93,
                category: 'crafting'
            },
            {
                id: 'craft_wooden_pickaxe',
                name: 'Craftear pico de madera',
                description: 'Create wooden pickaxe to mine stone',
                prereqs: ['craft_crafting_table', 'craft_sticks'],
                verify: (inv) => this._hasItem(inv, 'wooden_pickaxe'),
                command: '!craftRecipe("wooden_pickaxe", 1)',
                priority: 92,
                category: 'tools'
            },

            // === FASE 2: Herramientas de Piedra ===
            {
                id: 'get_cobblestone',
                name: 'Obtener 32 cobblestone',
                description: 'Mine cobblestone with wooden pickaxe',
                prereqs: ['craft_wooden_pickaxe'],
                verify: (inv) => inv['cobblestone'] >= 32,
                command: '!collectBlocks("stone", 32)',
                priority: 90,
                category: 'gathering'
            },
            {
                id: 'craft_stone_pickaxe',
                name: 'Craftear pico de piedra',
                description: 'Upgrade to stone pickaxe',
                prereqs: ['get_cobblestone', 'craft_sticks'],
                verify: (inv) => this._hasItem(inv, 'stone_pickaxe'),
                command: '!craftRecipe("stone_pickaxe", 1)',
                priority: 88,
                category: 'tools'
            },
            {
                id: 'craft_stone_sword',
                name: 'Craftear espada de piedra',
                description: 'Create stone sword for combat',
                prereqs: ['get_cobblestone', 'craft_sticks'],
                verify: (inv) => this._hasItem(inv, 'stone_sword'),
                command: '!craftRecipe("stone_sword", 1)',
                priority: 87,
                category: 'combat'
            },
            {
                id: 'craft_stone_axe',
                name: 'Craftear hacha de piedra',
                description: 'Create stone axe for faster wood',
                prereqs: ['get_cobblestone', 'craft_sticks'],
                verify: (inv) => this._hasItem(inv, 'stone_axe'),
                command: '!craftRecipe("stone_axe", 1)',
                priority: 86,
                category: 'tools'
            },
            {
                id: 'craft_furnace',
                name: 'Craftear horno',
                description: 'Create furnace for smelting',
                prereqs: ['get_cobblestone'],
                verify: (inv) => this._hasItem(inv, 'furnace'),
                command: '!craftRecipe("furnace", 1)',
                priority: 85,
                category: 'crafting'
            },

            // === FASE 3: Recursos Avanzados ===
            {
                id: 'get_coal',
                name: 'Obtener 16 carbón',
                description: 'Mine coal ore',
                prereqs: ['craft_stone_pickaxe'],
                verify: (inv) => inv['coal'] >= 16,
                command: '!collectBlocks("coal_ore", 16)',
                priority: 80,
                category: 'gathering'
            },
            {
                id: 'craft_torches',
                name: 'Craftear 32 antorchas',
                description: 'Create torches for lighting',
                prereqs: ['get_coal', 'craft_sticks'],
                verify: (inv) => inv['torch'] >= 32,
                command: '!craftRecipe("torch", 32)',
                priority: 79,
                category: 'crafting'
            },
            {
                id: 'get_iron_ore',
                name: 'Obtener 16 hierro crudo',
                description: 'Mine iron ore',
                prereqs: ['craft_stone_pickaxe'],
                verify: (inv) => inv['raw_iron'] >= 16,
                command: '!collectBlocks("iron_ore", 16)',
                priority: 78,
                category: 'gathering'
            },
            {
                id: 'smelt_iron',
                name: 'Fundir 16 lingotes de hierro',
                description: 'Smelt raw iron into ingots',
                prereqs: ['get_iron_ore', 'craft_furnace', 'get_coal'],
                verify: (inv) => inv['iron_ingot'] >= 16,
                command: '!smeltItem("raw_iron", 16)',
                priority: 75,
                category: 'crafting'
            },

            // === FASE 4: Herramientas de Hierro ===
            {
                id: 'craft_iron_pickaxe',
                name: 'Craftear pico de hierro',
                description: 'Create iron pickaxe for diamonds',
                prereqs: ['smelt_iron', 'craft_sticks'],
                verify: (inv) => this._hasItem(inv, 'iron_pickaxe'),
                command: '!craftRecipe("iron_pickaxe", 1)',
                priority: 70,
                category: 'tools'
            },
            {
                id: 'craft_iron_sword',
                name: 'Craftear espada de hierro',
                description: 'Create iron sword',
                prereqs: ['smelt_iron', 'craft_sticks'],
                verify: (inv) => this._hasItem(inv, 'iron_sword'),
                command: '!craftRecipe("iron_sword", 1)',
                priority: 69,
                category: 'combat'
            },
            {
                id: 'craft_iron_armor',
                name: 'Craftear armadura de hierro completa',
                description: 'Create full iron armor set',
                prereqs: ['smelt_iron'],
                verify: (inv) => this._hasItem(inv, 'iron_helmet') && this._hasItem(inv, 'iron_chestplate') && this._hasItem(inv, 'iron_leggings') && this._hasItem(inv, 'iron_boots'),
                command: '!newAction("Craft complete iron armor: helmet, chestplate, leggings, boots")',
                priority: 68,
                category: 'combat'
            },
            {
                id: 'craft_shield',
                name: 'Craftear escudo',
                description: 'Create shield for defense',
                prereqs: ['smelt_iron', 'craft_planks'],
                verify: (inv) => this._hasItem(inv, 'shield'),
                command: '!craftRecipe("shield", 1)',
                priority: 67,
                category: 'combat'
            },
            {
                id: 'craft_bucket',
                name: 'Craftear cubo',
                description: 'Create bucket for water/lava',
                prereqs: ['smelt_iron'],
                verify: (inv) => this._hasItem(inv, 'bucket'),
                command: '!craftRecipe("bucket", 1)',
                priority: 66,
                category: 'tools'
            },

            // === FASE 5: Diamantes ===
            {
                id: 'get_diamonds',
                name: 'Obtener 5 diamantes',
                description: 'Mine diamond ore (requires iron pickaxe, Y level -64 to 16)',
                prereqs: ['craft_iron_pickaxe'],
                verify: (inv) => inv['diamond'] >= 5,
                command: '!newAction("Mine diamonds: go to Y level -50 to -60, mine diamond ore. Need at least 5 diamonds.")',
                priority: 60,
                category: 'gathering'
            },
            {
                id: 'craft_diamond_pickaxe',
                name: 'Craftear pico de diamante',
                description: 'Create diamond pickaxe',
                prereqs: ['get_diamonds', 'craft_sticks'],
                verify: (inv) => this._hasItem(inv, 'diamond_pickaxe'),
                command: '!craftRecipe("diamond_pickaxe", 1)',
                priority: 55,
                category: 'tools'
            },
            {
                id: 'craft_diamond_sword',
                name: 'Craftear espada de diamante',
                description: 'Create diamond sword',
                prereqs: ['get_diamonds', 'craft_sticks'],
                verify: (inv) => this._hasItem(inv, 'diamond_sword'),
                command: '!craftRecipe("diamond_sword", 1)',
                priority: 54,
                category: 'combat'
            },

            // === FASE 6: Nether (Avanzado) ===
            {
                id: 'get_obsidian',
                name: 'Obtener 10 obsidiana',
                description: 'Mine obsidian with diamond pickaxe',
                prereqs: ['craft_diamond_pickaxe', 'craft_bucket'],
                verify: (inv) => inv['obsidian'] >= 10,
                command: '!newAction("Get obsidian: find lava pool, use water bucket to create obsidian, mine with diamond pickaxe. Need 10 obsidian.")',
                priority: 50,
                category: 'gathering'
            },
            {
                id: 'craft_flint_and_steel',
                name: 'Craftear mechero',
                description: 'Create flint and steel for portal',
                prereqs: ['smelt_iron'],
                verify: (inv) => this._hasItem(inv, 'flint_and_steel'),
                command: '!craftRecipe("flint_and_steel", 1)',
                priority: 49,
                category: 'tools'
            },
            {
                id: 'build_nether_portal',
                name: 'Construir portal al Nether',
                description: 'Build and light nether portal',
                prereqs: ['get_obsidian', 'craft_flint_and_steel'],
                verify: () => this._checkNetherPortalNearby(),
                command: '!newAction("Build nether portal: place obsidian in 4x5 frame, light with flint and steel")',
                priority: 45,
                category: 'building'
            },

            // === FASE 7: Exploración Nether ===
            {
                id: 'enter_nether',
                name: 'Entrar al Nether',
                description: 'Go through nether portal',
                prereqs: ['build_nether_portal'],
                verify: () => this.bot.game?.dimension === 'the_nether',
                command: '!newAction("Enter the nether portal")',
                priority: 40,
                category: 'exploration'
            },
            {
                id: 'get_blaze_rods',
                name: 'Obtener 7 blaze rods',
                description: 'Kill blazes in nether fortress',
                prereqs: ['enter_nether', 'craft_iron_armor'],
                verify: (inv) => inv['blaze_rod'] >= 7,
                command: '!newAction("Find nether fortress, kill blazes to get 7 blaze rods")',
                priority: 35,
                category: 'combat'
            },
            {
                id: 'get_ender_pearls',
                name: 'Obtener 12 ender pearls',
                description: 'Kill endermen or trade with piglins',
                prereqs: ['smelt_iron'],
                verify: (inv) => inv['ender_pearl'] >= 12,
                command: '!newAction("Get ender pearls: kill endermen at night or trade gold with piglins in nether")',
                priority: 34,
                category: 'gathering'
            },
            {
                id: 'craft_eyes_of_ender',
                name: 'Craftear 12 ojos de ender',
                description: 'Combine blaze powder with ender pearls',
                prereqs: ['get_blaze_rods', 'get_ender_pearls'],
                verify: (inv) => inv['ender_eye'] >= 12,
                command: '!newAction("Craft blaze powder from blaze rods, then craft 12 eyes of ender")',
                priority: 30,
                category: 'crafting'
            },

            // === FASE 8: End Game ===
            {
                id: 'find_stronghold',
                name: 'Encontrar stronghold',
                description: 'Use eyes of ender to locate stronghold',
                prereqs: ['craft_eyes_of_ender'],
                verify: () => this._checkStrongholdNearby(),
                command: '!newAction("Use eyes of ender to find stronghold, follow them until they go down")',
                priority: 25,
                category: 'exploration'
            },
            {
                id: 'activate_end_portal',
                name: 'Activar portal del End',
                description: 'Place eyes of ender in portal frame',
                prereqs: ['find_stronghold', 'craft_eyes_of_ender'],
                verify: () => this._checkEndPortalActivated(),
                command: '!newAction("Find end portal room in stronghold, place eyes of ender in all frames")',
                priority: 20,
                category: 'building'
            },
            {
                id: 'defeat_ender_dragon',
                name: 'Derrotar al Ender Dragon',
                description: 'Enter End and defeat the dragon',
                prereqs: ['activate_end_portal', 'craft_diamond_sword', 'craft_iron_armor'],
                verify: () => this._checkDragonDefeated(),
                command: '!newAction("Enter End portal, destroy end crystals on towers, then fight and defeat the Ender Dragon")',
                priority: 10,
                category: 'combat'
            }
        ];
    }

    /**
     * Inicia el curriculum de aprendizaje autónomo
     */
    async start() {
        if (this.isRunning) {
            console.log('[Curriculum] Already running');
            return;
        }

        this.isRunning = true;
        this.isPaused = false;
        console.log('[Curriculum] Starting autonomous learning...');
        console.log(`[Curriculum] Progress: ${this.completedTasks.length}/${this.techTree.length} tasks completed`);

        await this._runLoop();
    }

    /**
     * Pausa el curriculum (para cuando hay jugadores online)
     */
    pause() {
        this.isPaused = true;
        console.log('[Curriculum] Paused');
    }

    /**
     * Reanuda el curriculum
     */
    resume() {
        if (!this.isRunning) {
            this.start();
            return;
        }
        this.isPaused = false;
        console.log('[Curriculum] Resumed');
    }

    /**
     * Detiene completamente el curriculum
     */
    stop() {
        this.isRunning = false;
        this.isPaused = false;
        this._saveProgress();
        console.log('[Curriculum] Stopped');
    }

    /**
     * Loop principal del curriculum
     */
    async _runLoop() {
        while (this.isRunning) {
            // Check si está pausado
            if (this.isPaused) {
                await this._sleep(5000);
                continue;
            }

            // Seleccionar siguiente tarea
            const task = this._selectNextTask();

            if (!task) {
                // Check if actually all completed or just blocked/failed
                const remaining = this.techTree.length - this.completedTasks.length;
                const failed = this.failedTasks.length;

                if (remaining === 0) {
                    console.log('[Curriculum] 🎉 All tasks completed! Minecraft mastered!');
                    this.isRunning = false;
                    break;
                } else if (failed > 0 && remaining === failed) {
                    console.log(`[Curriculum] ⚠️ Blocked: ${failed} failed tasks. Retrying...`);
                    this.retryFailedTasks();
                    await this._sleep(10000);
                    continue;
                } else {
                    console.log(`[Curriculum] ⏳ Waiting: ${remaining} tasks remaining but prerequisites not met`);
                    await this._sleep(30000); // Wait for other bots to complete prereqs
                    continue;
                }
            }

            this.currentTask = task;
            console.log(`[Curriculum] Next task: ${task.name}`);

            // Intentar completar la tarea
            const success = await this._attemptTask(task);

            if (success) {
                console.log(`[Curriculum] ✓ Completed: ${task.name}`);
                this.completedTasks.push(task.id);
                this.taskAttempts = 0;

                // Guardar skill si usó newAction
                if (task.command.includes('!newAction')) {
                    await this._saveLearnedSkill(task);
                }
            } else {
                this.taskAttempts++;
                console.log(`[Curriculum] ✗ Failed: ${task.name} (attempt ${this.taskAttempts}/${this.maxRetries})`);

                if (this.taskAttempts >= this.maxRetries) {
                    console.log(`[Curriculum] Task too difficult, skipping: ${task.name}`);
                    this.failedTasks.push(task.id);
                    this.taskAttempts = 0;
                }
            }

            this._saveProgress();

            // Cooldown entre tareas
            await this._sleep(3000);
        }
    }

    /**
     * Selecciona la siguiente tarea basándose en prerrequisitos y prioridad
     */
    _selectNextTask() {
        const availableTasks = this.techTree.filter(task => {
            // No completada ni fallada
            if (this.completedTasks.includes(task.id)) return false;
            if (this.failedTasks.includes(task.id)) return false;

            // Todos los prerrequisitos completados
            return task.prereqs.every(prereq => this.completedTasks.includes(prereq));
        });

        if (availableTasks.length === 0) return null;

        // Ordenar por prioridad (mayor primero)
        availableTasks.sort((a, b) => b.priority - a.priority);

        return availableTasks[0];
    }

    /**
     * Intenta completar una tarea
     */
    async _attemptTask(task) {
        const startTime = Date.now();

        try {
            // Verificar si ya está completada
            const inventory = this._getInventory();
            if (task.verify(inventory)) {
                return true;
            }

            // Ejecutar comando
            console.log(`[Curriculum] Executing: ${task.command}`);

            // Usar self-prompter para ejecutar la tarea
            const prompt = `Complete this task: ${task.name}. ${task.description}. Use command: ${task.command}`;

            await this.agent.self_prompter.start(prompt);

            // Esperar a que termine o timeout
            while (this.agent.self_prompter.isActive()) {
                if (Date.now() - startTime > this.taskTimeoutMs) {
                    console.log('[Curriculum] Task timeout');
                    await this.agent.self_prompter.stop();
                    break;
                }

                // Verificar si ya completó
                const currentInv = this._getInventory();
                if (task.verify(currentInv)) {
                    await this.agent.self_prompter.stop();
                    return true;
                }

                if (this.isPaused) {
                    await this.agent.self_prompter.pause();
                    break;
                }

                await this._sleep(2000);
            }

            // Verificación final
            const finalInv = this._getInventory();
            return task.verify(finalInv);

        } catch (error) {
            console.error(`[Curriculum] Error in task ${task.name}:`, error.message);
            return false;
        }
    }

    /**
     * Guarda un skill aprendido en ProceduralMemory
     */
    async _saveLearnedSkill(task) {
        // Usar persistentMemory (nombre correcto del sistema de memoria en el agente)
        const memory = this.agent.persistentMemory || this.agent.memory;
        if (!memory?.procedural) {
            console.log('[Curriculum] No procedural memory available to save skill');
            return;
        }

        try {
            await memory.procedural.learnFromSuccess(
                task.name,
                task.description,
                task.command,
                task.prereqs.map(p => this.techTree.find(t => t.id === p)?.name || p),
                task.category
            );
            console.log(`[Curriculum] Saved skill: ${task.name}`);
        } catch (error) {
            console.error('[Curriculum] Failed to save skill:', error.message);
        }
    }

    // === Helpers ===

    _getInventory() {
        const inventory = {};
        this.bot.inventory.items().forEach(item => {
            inventory[item.name] = (inventory[item.name] || 0) + item.count;
        });
        return inventory;
    }

    _hasItem(inventory, itemName) {
        return (inventory[itemName] || 0) > 0;
    }

    _countItems(inventory, itemNames) {
        return itemNames.reduce((sum, name) => sum + (inventory[name] || 0), 0);
    }

    _checkNetherPortalNearby() {
        const portal = this.bot.findBlock({
            matching: block => block.name === 'nether_portal',
            maxDistance: 32
        });
        return portal !== null;
    }

    _checkStrongholdNearby() {
        const stoneBrick = this.bot.findBlock({
            matching: block => block.name === 'stone_bricks',
            maxDistance: 64
        });
        return stoneBrick !== null && this.bot.entity.position.y < 40;
    }

    _checkEndPortalActivated() {
        const endPortal = this.bot.findBlock({
            matching: block => block.name === 'end_portal',
            maxDistance: 32
        });
        return endPortal !== null;
    }

    _checkDragonDefeated() {
        // Check for dragon egg or end gateway
        const dragonEgg = this.bot.findBlock({
            matching: block => block.name === 'dragon_egg',
            maxDistance: 100
        });
        return dragonEgg !== null;
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // === Persistencia ===

    _saveProgress() {
        const data = {
            completedTasks: this.completedTasks,
            failedTasks: this.failedTasks,
            lastUpdate: new Date().toISOString()
        };

        try {
            writeFileSync(
                path.join(this.dataPath, 'progress.json'),
                JSON.stringify(data, null, 2)
            );
        } catch (error) {
            console.error('[Curriculum] Failed to save progress:', error.message);
        }
    }

    _loadProgress() {
        const filePath = path.join(this.dataPath, 'progress.json');

        if (!existsSync(filePath)) {
            this.completedTasks = [];
            this.failedTasks = [];
            return;
        }

        try {
            const data = JSON.parse(readFileSync(filePath, 'utf8'));
            this.completedTasks = data.completedTasks || [];
            this.failedTasks = data.failedTasks || [];
            console.log(`[Curriculum] Loaded progress: ${this.completedTasks.length} completed, ${this.failedTasks.length} failed`);
        } catch (error) {
            console.error('[Curriculum] Failed to load progress:', error.message);
            this.completedTasks = [];
            this.failedTasks = [];
        }
    }

    // === API Pública ===

    getProgress() {
        return {
            completed: this.completedTasks.length,
            failed: this.failedTasks.length,
            total: this.techTree.length,
            percentage: Math.round(100 * this.completedTasks.length / this.techTree.length),
            currentTask: this.currentTask?.name || null,
            isRunning: this.isRunning,
            isPaused: this.isPaused
        };
    }

    getNextTasks(count = 5) {
        const available = this.techTree.filter(task => {
            if (this.completedTasks.includes(task.id)) return false;
            if (this.failedTasks.includes(task.id)) return false;
            return task.prereqs.every(prereq => this.completedTasks.includes(prereq));
        });

        available.sort((a, b) => b.priority - a.priority);
        return available.slice(0, count);
    }

    resetProgress() {
        this.completedTasks = [];
        this.failedTasks = [];
        this._saveProgress();
        console.log('[Curriculum] Progress reset');
    }

    retryFailedTasks() {
        this.failedTasks = [];
        this._saveProgress();
        console.log('[Curriculum] Failed tasks cleared, will retry');
    }
}

export default CurriculumEngine;
