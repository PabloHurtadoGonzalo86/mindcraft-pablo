import * as skills from './library/skills.js';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';
import settings from './settings.js'
import convoManager from './conversation.js';

async function say(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    if (agent.shut_up || !settings.narrate_behavior) return;
    agent.openChat(message);
}

// a mode is a function that is called every tick to respond immediately to the world
// it has the following fields:
// on: whether 'update' is called every tick
// active: whether an action has been triggered by the mode and hasn't yet finished
// paused: whether the mode is paused by another action that overrides the behavior (eg followplayer implements its own self defense)
// update: the function that is called every tick (if on is true)
// when a mode is active, it will trigger an action to be performed but won't wait for it to return output

// the order of this list matters! first modes will be prioritized
// while update functions are async, they should *not* be awaited longer than ~100ms as it will block the update loop
// to perform longer actions, use the execute function which won't block the update loop
const modes_list = [
    {
        name: 'self_preservation',
        description: 'Respond to drowning, burning, and damage at low health. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        fall_blocks: ['sand', 'gravel', 'concrete_powder'], // includes matching substrings like 'sandstone' and 'red_sand'
        last_critical_alert: 0,
        update: async function (agent) {
            const bot = agent.bot;
            let block = bot.blockAt(bot.entity.position);
            let blockAbove = bot.blockAt(bot.entity.position.offset(0, 1, 0));
            if (!block) block = {name: 'air'}; // hacky fix when blocks are not loaded
            if (!blockAbove) blockAbove = {name: 'air'};
            if (blockAbove.name === 'water') {
                // does not call execute so does not interrupt other actions
                if (!bot.pathfinder.goal) {
                    bot.setControlState('jump', true);
                }
            }
            else if (this.fall_blocks.some(name => blockAbove.name.includes(name))) {
                execute(this, agent, async () => {
                    await skills.moveAway(bot, 2);
                });
            }
            else if (block.name === 'lava' || block.name === 'fire' ||
                blockAbove.name === 'lava' || blockAbove.name === 'fire') {
                say(agent, 'I\'m on fire!');
                // if you have a water bucket, use it
                let waterBucket = bot.inventory.items().find(item => item.name === 'water_bucket');
                if (waterBucket) {
                    execute(this, agent, async () => {
                        let success = await skills.placeBlock(bot, 'water_bucket', block.position.x, block.position.y, block.position.z);
                        if (success) say(agent, 'Placed some water, ahhhh that\'s better!');
                    });
                }
                else {
                    execute(this, agent, async () => {
                        let waterBucket = bot.inventory.items().find(item => item.name === 'water_bucket');
                        if (waterBucket) {
                            let success = await skills.placeBlock(bot, 'water_bucket', block.position.x, block.position.y, block.position.z);
                            if (success) say(agent, 'Placed some water, ahhhh that\'s better!');
                            return;
                        }
                        let nearestWater = world.getNearestBlock(bot, 'water', 20);
                        if (nearestWater) {
                            const pos = nearestWater.position;
                            let success = await skills.goToPosition(bot, pos.x, pos.y, pos.z, 0.2);
                            if (success) say(agent, 'Found some water, ahhhh that\'s better!');
                            return;
                        }
                        await skills.moveAway(bot, 5);
                    });
                }
            }
            // IMPROVED: More aggressive survival thresholds
            // Critical: health < 6 OR food < 4 OR taking damage with low health
            else if (bot.health < 6 || bot.food < 4 ||
                     (Date.now() - bot.lastDamageTime < 3000 && (bot.health < 8 || bot.lastDamageTaken >= bot.health * 0.5))) {

                // Determine the severity and respond appropriately
                const isCritical = bot.health < 4 || bot.food < 2;
                const isEmergency = bot.health < 6 || bot.food < 4;

                // Alert (but not too frequently)
                if (isCritical && Date.now() - this.last_critical_alert > 15000) {
                    this.last_critical_alert = Date.now();
                    say(agent, `CRITICAL: Health ${bot.health.toFixed(0)}/20, Food ${bot.food}/20! Need help!`);
                } else if (isEmergency && Date.now() - this.last_critical_alert > 30000) {
                    this.last_critical_alert = Date.now();
                    say(agent, `Low health (${bot.health.toFixed(0)}) or food (${bot.food}), need to recover!`);
                }

                execute(this, agent, async () => {
                    // First try to eat if we have food and are hungry
                    if (bot.food < 14) {
                        const foodItems = [
                            'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
                            'cooked_cod', 'cooked_salmon', 'baked_potato', 'bread',
                            'golden_apple', 'apple', 'carrot', 'melon_slice', 'sweet_berries'
                        ];
                        for (const foodName of foodItems) {
                            const food = bot.inventory.items().find(i => i.name === foodName);
                            if (food) {
                                try {
                                    await bot.equip(food, 'hand');
                                    await bot.consume();
                                    say(agent, `Ate ${foodName}, feeling better!`);
                                    return;
                                } catch (e) {
                                    // Failed to eat, continue to escape
                                }
                            }
                        }
                    }

                    // If critical or taking damage, flee
                    if (isCritical || Date.now() - bot.lastDamageTime < 3000) {
                        await skills.moveAway(bot, 20);
                    } else if (isEmergency) {
                        // Just move away a bit for non-critical emergencies
                        await skills.moveAway(bot, 8);
                    }
                });
            }
            else if (agent.isIdle()) {
                bot.clearControlStates(); // clear jump if not in danger or doing anything else
            }
        }
    },
    {
        name: 'food_seeking',
        description: 'Actively seek and obtain food when hungry. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        last_alert: 0,
        last_hunt_attempt: 0,
        update: async function (agent) {
            const bot = agent.bot;

            // Activate earlier and more aggressively when food is low
            const urgentHunger = bot.food < 6;
            const moderateHunger = bot.food <= 12;

            if (!urgentHunger && !moderateHunger) return;

            // 1. Check if has food in inventory (prefer cooked, but allow raw in emergencies)
            const preferredFood = bot.inventory.items().find(item =>
                item.name.includes('cooked') ||
                item.name === 'bread' ||
                item.name === 'apple' ||
                item.name === 'golden_apple' ||
                item.name === 'carrot' ||
                item.name === 'potato' ||
                item.name === 'baked_potato' ||
                item.name === 'beetroot' ||
                item.name === 'melon_slice' ||
                item.name === 'sweet_berries' ||
                item.name === 'glow_berries' ||
                item.name === 'dried_kelp' ||
                item.name === 'cookie' ||
                item.name === 'pumpkin_pie'
            );

            // In extreme emergency (food < 3), allow raw food as last resort
            const rawFood = bot.food < 3 ? bot.inventory.items().find(item =>
                item.name === 'beef' ||
                item.name === 'porkchop' ||
                item.name === 'chicken' ||
                item.name === 'mutton' ||
                item.name === 'rabbit' ||
                item.name === 'cod' ||
                item.name === 'salmon' ||
                item.name === 'rotten_flesh' // Very last resort
            ) : null;

            const foodItem = preferredFood || rawFood;

            if (foodItem) {
                // Has food - try to eat it immediately if urgent
                if (urgentHunger) {
                    execute(this, agent, async () => {
                        try {
                            await bot.equip(foodItem, 'hand');
                            await bot.consume();
                            say(agent, `Eating ${foodItem.name} to restore hunger!`);
                        } catch (e) {
                            // Auto-eat should handle it
                        }
                    });
                }
                return;
            }

            // No food in inventory - need to find some
            // Rate limit hunting attempts to avoid spam
            const timeSinceLastHunt = Date.now() - this.last_hunt_attempt;
            if (timeSinceLastHunt < 10000 && !urgentHunger) return;

            // 2. Hunt animals for food (larger range when more hungry)
            const huntRange = urgentHunger ? 48 : 32;
            const huntable = world.getNearestEntityWhere(bot, entity => mc.isHuntable(entity), huntRange);

            if (huntable && await world.isClearPath(bot, huntable)) {
                this.last_hunt_attempt = Date.now();
                say(agent, urgentHunger
                    ? `URGENT: Starving! Hunting ${huntable.name} for food!`
                    : `Getting hungry, hunting ${huntable.name}!`);
                execute(this, agent, async () => {
                    await skills.attackEntity(bot, huntable);
                    // After killing, try to pick up drops
                    await new Promise(r => setTimeout(r, 1000));
                    await skills.pickupNearbyItems(bot);
                });
                return;
            }

            // 3. Look for berry bushes (easier to get than crops)
            const berryBush = world.getNearestBlock(bot, 'sweet_berry_bush', 32);
            if (berryBush) {
                this.last_hunt_attempt = Date.now();
                say(agent, `Found berry bush, harvesting!`);
                execute(this, agent, async () => {
                    await skills.goToPosition(bot, berryBush.position.x, berryBush.position.y, berryBush.position.z, 2);
                    // Actually harvest the berries
                    try {
                        const bush = bot.blockAt(berryBush.position);
                        if (bush && bush.name === 'sweet_berry_bush') {
                            await bot.activateBlock(bush);
                            await skills.pickupNearbyItems(bot);
                        }
                    } catch (e) { /* ignore harvest errors */ }
                });
                return;
            }

            // 4. Look for mature crops (wheat, carrots, potatoes)
            const cropTypes = ['wheat', 'carrots', 'potatoes', 'beetroots'];
            let foundCrop = null;
            for (const cropType of cropTypes) {
                foundCrop = world.getNearestBlock(bot, cropType, 32);
                if (foundCrop) break;
            }
            if (foundCrop) {
                this.last_hunt_attempt = Date.now();
                say(agent, `Found ${foundCrop.name}, harvesting for food!`);
                execute(this, agent, async () => {
                    await skills.goToPosition(bot, foundCrop.position.x, foundCrop.position.y, foundCrop.position.z, 2);
                    // Actually harvest the crop
                    try {
                        await skills.collectBlock(bot, foundCrop.name, 5);
                        await skills.pickupNearbyItems(bot);
                    } catch (e) { /* ignore harvest errors */ }
                });
                return;
            }

            // 5. EMERGENCY - ask for help (but not too often)
            if (urgentHunger && Date.now() - this.last_alert > 20000) {
                this.last_alert = Date.now();
                say(agent, `EMERGENCY: Starving (food: ${bot.food}/20) and can't find any food sources! Need help!`);
            } else if (moderateHunger && Date.now() - this.last_alert > 60000) {
                this.last_alert = Date.now();
                say(agent, `Getting hungry (food: ${bot.food}/20), looking for food sources...`);
            }
        }
    },
    {
        name: 'unstuck',
        description: 'Attempt to get unstuck when in the same place for a while. Interrupts some actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        prev_location: null,
        distance: 2,
        stuck_time: 0,
        last_time: Date.now(),
        max_stuck_time: 20,
        prev_dig_block: null,
        update: async function (agent) {
            if (agent.isIdle()) { 
                this.prev_location = null;
                this.stuck_time = 0;
                return; // don't get stuck when idle
            }
            const bot = agent.bot;
            const cur_dig_block = bot.targetDigBlock;
            if (cur_dig_block && !this.prev_dig_block) {
                this.prev_dig_block = cur_dig_block;
            }
            if (this.prev_location && this.prev_location.distanceTo(bot.entity.position) < this.distance && cur_dig_block == this.prev_dig_block) {
                this.stuck_time += (Date.now() - this.last_time) / 1000;
            }
            else {
                this.prev_location = bot.entity.position.clone();
                this.stuck_time = 0;
                this.prev_dig_block = null;
            }
            const max_stuck_time = cur_dig_block?.name === 'obsidian' ? this.max_stuck_time * 2 : this.max_stuck_time;
            if (this.stuck_time > max_stuck_time) {
                say(agent, 'I\'m stuck!');
                this.stuck_time = 0;
                execute(this, agent, async () => {
                    const crashTimeout = setTimeout(() => { agent.cleanKill("Got stuck and couldn't get unstuck") }, 10000);
                    await skills.moveAway(bot, 5);
                    clearTimeout(crashTimeout);
                    say(agent, 'I\'m free.');
                });
            }
            this.last_time = Date.now();
        },
        unpause: function () {
            this.prev_location = null;
            this.stuck_time = 0;
            this.prev_dig_block = null;
        }
    },
    {
        name: 'cowardice',
        description: 'Run away from enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            const enemy = world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity), 16);
            if (enemy && await world.isClearPath(agent.bot, enemy)) {
                say(agent, `Aaa! A ${enemy.name.replace("_", " ")}!`);
                execute(this, agent, async () => {
                    await skills.avoidEnemies(agent.bot, 24);
                });
            }
        }
    },
    {
        name: 'self_defense',
        description: 'Attack nearby enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            const enemy = world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity), 8);
            if (enemy && await world.isClearPath(agent.bot, enemy)) {
                say(agent, `Fighting ${enemy.name}!`);
                execute(this, agent, async () => {
                    await skills.defendSelf(agent.bot, 8);
                });
            }
        }
    },
    {
        name: 'hunting',
        description: 'Hunt nearby animals when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        update: async function (agent) {
            const huntable = world.getNearestEntityWhere(agent.bot, entity => mc.isHuntable(entity), 8);
            if (huntable && await world.isClearPath(agent.bot, huntable)) {
                execute(this, agent, async () => {
                    say(agent, `Hunting ${huntable.name}!`);
                    await skills.attackEntity(agent.bot, huntable);
                });
            }
        }
    },
    {
        name: 'item_collecting',
        description: 'Collect nearby items when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,

        wait: 2, // number of seconds to wait after noticing an item to pick it up
        prev_item: null,
        noticed_at: -1,
        update: async function (agent) {
            let item = world.getNearestEntityWhere(agent.bot, entity => entity.name === 'item', 8);
            let empty_inv_slots = agent.bot.inventory.emptySlotCount();
            if (item && item !== this.prev_item && await world.isClearPath(agent.bot, item) && empty_inv_slots > 1) {
                if (this.noticed_at === -1) {
                    this.noticed_at = Date.now();
                }
                if (Date.now() - this.noticed_at > this.wait * 1000) {
                    say(agent, `Picking up item!`);
                    this.prev_item = item;
                    execute(this, agent, async () => {
                        await skills.pickupNearbyItems(agent.bot);
                    });
                    this.noticed_at = -1;
                }
            }
            else {
                this.noticed_at = -1;
            }
        }
    },
    {
        name: 'torch_placing',
        description: 'Place torches when idle and there are no torches nearby.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        cooldown: 5,
        last_place: Date.now(),
        update: function (agent) {
            if (world.shouldPlaceTorch(agent.bot)) {
                if (Date.now() - this.last_place < this.cooldown * 1000) return;
                execute(this, agent, async () => {
                    const pos = agent.bot.entity.position;
                    await skills.placeBlock(agent.bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
                });
                this.last_place = Date.now();
            }
        }
    },
    {
        name: 'elbow_room',
        description: 'Move away from nearby players when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        distance: 0.5,
        update: async function (agent) {
            const player = world.getNearestEntityWhere(agent.bot, entity => entity.type === 'player', this.distance);
            if (player) {
                execute(this, agent, async () => {
                    // wait a random amount of time to avoid identical movements with other bots
                    const wait_time = Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, wait_time));
                    if (player.position.distanceTo(agent.bot.entity.position) < this.distance) {
                        await skills.moveAwayFromEntity(agent.bot, player, this.distance);
                    }
                });
            }
        }
    },
    {
        name: 'idle_staring',
        description: 'Animation to look around at entities when idle.',
        interrupts: [],
        on: true,
        active: false,

        staring: false,
        last_entity: null,
        next_change: 0,
        update: function (agent) {
            const entity = agent.bot.nearestEntity();
            let entity_in_view = entity && entity.position.distanceTo(agent.bot.entity.position) < 10 && entity.name !== 'enderman';
            if (entity_in_view && entity !== this.last_entity) {
                this.staring = true;
                this.last_entity = entity;
                this.next_change = Date.now() + Math.random() * 1000 + 4000;
            }
            if (entity_in_view && this.staring) {
                let isbaby = entity.type !== 'player' && entity.metadata[16];
                let height = isbaby ? entity.height/2 : entity.height;
                agent.bot.lookAt(entity.position.offset(0, height, 0));
            }
            if (!entity_in_view)
                this.last_entity = null;
            if (Date.now() > this.next_change) {
                // look in random direction
                this.staring = Math.random() < 0.3;
                if (!this.staring) {
                    const yaw = Math.random() * Math.PI * 2;
                    const pitch = (Math.random() * Math.PI/2) - Math.PI/4;
                    agent.bot.look(yaw, pitch, false);
                }
                this.next_change = Date.now() + Math.random() * 10000 + 2000;
            }
        }
    },
    {
        name: 'cheat',
        description: 'Use cheats to instantly place blocks and teleport.',
        interrupts: [],
        on: false,
        active: false,
        update: function (agent) { /* do nothing */ }
    },
    // === ROLE-SPECIFIC BEHAVIORS ===
    {
        name: 'farmer_role',
        description: 'Diana (FARMER): Automatically tend crops and produce food when idle.',
        interrupts: [],
        on: false, // Enabled only for Diana
        active: false,
        last_farm_check: 0,
        update: async function (agent) {
            // Only run every 30 seconds
            if (Date.now() - this.last_farm_check < 30000) return;
            this.last_farm_check = Date.now();

            const bot = agent.bot;

            // Check if we have seeds but little food
            const food = bot.inventory.items().find(item =>
                item.name.includes('cooked') || item.name === 'bread'
            );
            const seeds = bot.inventory.items().find(item =>
                item.name === 'wheat_seeds' || item.name === 'beetroot_seeds'
            );

            // If low on food and have seeds, farm
            if (!food && seeds) {
                const farmland = world.getNearestBlock(bot, 'farmland', 32);
                if (farmland) {
                    execute(this, agent, async () => {
                        say(agent, 'Time to tend the crops!');
                        await skills.goToPosition(bot, farmland.position.x, farmland.position.y, farmland.position.z, 2);
                    });
                }
            }
        }
    },
    {
        name: 'guard_role',
        description: 'Hugo (GUARD): Patrol and protect other bots from danger.',
        interrupts: ['all'],
        on: false, // Enabled only for Hugo
        active: false,
        last_patrol: 0,
        last_survival_warning: 0,
        update: async function (agent) {
            const bot = agent.bot;

            // SURVIVAL CHECK: Don't engage in combat or patrol if in survival crisis
            // This is critical - a guard with 1 HP should NOT be fighting!
            if (bot.health < 8 || bot.food < 6) {
                // Only warn occasionally to avoid spam
                if (Date.now() - this.last_survival_warning > 30000) {
                    this.last_survival_warning = Date.now();
                    console.log(`[guard_role] Survival mode - skipping guard duties (Health: ${bot.health.toFixed(1)}, Food: ${bot.food})`);
                    if (bot.health < 4 || bot.food < 3) {
                        say(agent, `I'm in critical condition (HP: ${bot.health.toFixed(0)}, Food: ${bot.food}). Can't guard right now!`);
                    }
                }
                return; // Skip guard duties when in survival crisis
            }

            // Only engage enemies if we have enough health to survive
            if (bot.health >= 8) {
                // Actively hunt hostile mobs within larger range
                const enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), 24);
                if (enemy && await world.isClearPath(bot, enemy)) {
                    // Check if we have a weapon
                    const hasWeapon = bot.inventory.items().some(item =>
                        item.name.includes('sword') || item.name.includes('axe')
                    );

                    // Only engage with weapon or if health is good
                    if (hasWeapon || bot.health >= 14) {
                        say(agent, `Hostile detected! Engaging ${enemy.name}!`);
                        execute(this, agent, async () => {
                            await skills.attackEntity(bot, enemy);
                        });
                        return;
                    } else {
                        // No weapon and not enough health - warn but don't engage
                        if (Date.now() - this.last_survival_warning > 30000) {
                            this.last_survival_warning = Date.now();
                            say(agent, `I see a ${enemy.name} but I need a weapon or more health to engage safely.`);
                        }
                        return;
                    }
                }
            }

            // Patrol around spawn area every 2 minutes (only if healthy)
            if (bot.health >= 10 && bot.food >= 8 && Date.now() - this.last_patrol > 120000) {
                this.last_patrol = Date.now();
                say(agent, 'Patrolling the area...');
                execute(this, agent, async () => {
                    await skills.moveAway(bot, 10);
                });
            }
        }
    },
    {
        name: 'merchant_role',
        description: 'Iris (MERCHANT): Manage and distribute resources to other bots.',
        interrupts: [],
        on: false, // Enabled only for Iris
        active: false,
        last_inventory_check: 0,
        update: async function (agent) {
            // Check inventory every minute
            if (Date.now() - this.last_inventory_check < 60000) return;
            this.last_inventory_check = Date.now();

            const bot = agent.bot;
            const inventory = bot.inventory.items();

            // Count excess food
            const foodItems = inventory.filter(item =>
                item.name.includes('cooked') || item.name === 'bread'
            );
            const totalFood = foodItems.reduce((sum, item) => sum + item.count, 0);

            // If we have excess food (> 32), announce it
            if (totalFood > 32) {
                say(agent, `I have ${totalFood} food items available for distribution!`);
            }
        }
    }
];

async function execute(mode, agent, func, timeout=-1) {
    if (agent.self_prompter.isActive())
        agent.self_prompter.stopLoop();
    let interrupted_action = agent.actions.currentActionLabel;
    mode.active = true;
    let code_return = await agent.actions.runAction(`mode:${mode.name}`, async () => {
        await func();
    }, { timeout });
    mode.active = false;
    console.log(`Mode ${mode.name} finished executing, code_return: ${code_return.message}`);

    let should_reprompt = 
        interrupted_action && // it interrupted a previous action
        !agent.actions.resume_func && // there is no resume function
        !agent.self_prompter.isActive() && // self prompting is not on
        !code_return.interrupted; // this mode action was not interrupted by something else

    if (should_reprompt) {
        // auto prompt to respond to the interruption
        let role = convoManager.inConversation() ? agent.last_sender : 'system';
        let logs = agent.bot.modes.flushBehaviorLog();
        agent.handleMessage(role, `(AUTO MESSAGE)Your previous action '${interrupted_action}' was interrupted by ${mode.name}.
        Your behavior log: ${logs}\nRespond accordingly.`);
    }
}

let _agent = null;
const modes_map = {};
for (let mode of modes_list) {
    modes_map[mode.name] = mode;
}

class ModeController {
    /*
    SECURITY WARNING:
    ModesController must be reference isolated. Do not store references to external objects like `agent`.
    This object is accessible by LLM generated code, so any stored references are also accessible.
    This can be used to expose sensitive information by malicious prompters.
    */
    constructor() {
        this.behavior_log = '';
    }

    exists(mode_name) {
        return modes_map[mode_name] != null;
    }

    setOn(mode_name, on) {
        modes_map[mode_name].on = on;
    }

    isOn(mode_name) {
        return modes_map[mode_name].on;
    }

    pause(mode_name) {
        modes_map[mode_name].paused = true;
    }

    unpause(mode_name) {
        const mode = modes_map[mode_name];
        //if  unpause func is defined and mode is currently paused
        if (mode.unpause && mode.paused) {
            mode.unpause();
        }
        mode.paused = false;
    }

    unPauseAll() {
        for (let mode of modes_list) {
            if (mode.paused) console.log(`Unpausing mode ${mode.name}`);
            this.unpause(mode.name);
        }
    }

    getMiniDocs() { // no descriptions
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on})`;
        }
        return res;
    }

    getDocs() {
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on}): ${mode.description}`;
        }
        return res;
    }

    async update() {
        if (_agent.isIdle()) {
            this.unPauseAll();
        }
        for (let mode of modes_list) {
            let interruptible = mode.interrupts.some(i => i === 'all') || mode.interrupts.some(i => i === _agent.actions.currentActionLabel);
            if (mode.on && !mode.paused && !mode.active && (_agent.isIdle() || interruptible)) {
                await mode.update(_agent);
            }
            if (mode.active) break;
        }
    }

    flushBehaviorLog() {
        const log = this.behavior_log;
        this.behavior_log = '';
        return log;
    }

    getJson() {
        let res = {};
        for (let mode of modes_list) {
            res[mode.name] = mode.on;
        }
        return res;
    }

    loadJson(json) {
        for (let mode of modes_list) {
            if (json[mode.name] != undefined) {
                mode.on = json[mode.name];
            }
        }
    }
}

export function initModes(agent) {
    _agent = agent;
    // the mode controller is added to the bot object so it is accessible from anywhere the bot is used
    agent.bot.modes = new ModeController();
    if (agent.task) {
        agent.bot.restrict_to_inventory = agent.task.restrict_to_inventory;
    }
    let modes_json = agent.prompter.getInitModes();
    if (modes_json) {
        agent.bot.modes.loadJson(modes_json);
    }

    // Enable role-specific modes based on agent name
    _enableRoleModes(agent.name);
}

function _enableRoleModes(agentName) {
    // Map agent names to their role modes
    const roleMap = {
        'Diana': 'farmer_role',
        'Hugo': 'guard_role',
        'Iris': 'merchant_role'
    };

    const roleMode = roleMap[agentName];
    if (roleMode && modes_map[roleMode]) {
        modes_map[roleMode].on = true;
        console.log(`[Modes] Enabled ${roleMode} for ${agentName}`);
    }
}
