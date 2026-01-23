import { History } from './history.js';
import { Coder } from './coder.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import { containsCommand, commandExists, executeCommand, truncCommandMessage, isAction, blacklistCommands } from './commands/index.js';
import { ActionManager } from './action_manager.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank } from './memory_bank.js';
import { SelfPrompter } from './self_prompter.js';
import convoManager from './conversation.js';
import { handleTranslation, handleEnglishTranslation } from '../utils/translator.js';
import { addBrowserViewer } from './vision/browser_viewer.js';
import { serverProxy, sendOutputToServer } from './mindserver_proxy.js';
import settings from './settings.js';
import { Task } from './tasks/tasks.js';
import { speak } from './speak.js';
import { log, validateNameFormat, handleDisconnection } from './connection_handler.js';
import PersistentMemorySystem from '../memory/index.js';
import { integrateHybridSystem } from '../hybrid/integration.js';
import { initializeCoordination, addCoordinationCommands } from '../coordination/index.js';

export class Agent {
    async start(load_mem=false, init_message=null, count_id=0) {
        this.last_sender = null;
        this.count_id = count_id;
        this._disconnectHandled = false;

        // Initialize components
        this.actions = new ActionManager(this);
        this.prompter = new Prompter(this, settings.profile);
        this.name = (this.prompter.getName() || '').trim();
        console.log(`Initializing agent ${this.name}...`);
        
        // Validate Name Format
        // connection_handler now ensures the message has [LoginGuard] prefix
        const nameCheck = validateNameFormat(this.name);
        if (!nameCheck.success) {
            log(this.name, nameCheck.msg);
            process.exit(1);
            return;
        }
        
        this.history = new History(this);
        this.coder = new Coder(this);
        this.npc = new NPCContoller(this);
        this.memory_bank = new MemoryBank();
        this.self_prompter = new SelfPrompter(this);
        convoManager.initAgent(this);
        await this.prompter.initExamples();

        // Initialize 4-Layer Persistent Memory System
        this.persistentMemory = new PersistentMemorySystem({
            agentName: this.name,
            // Episodic + Procedural Memory (Qdrant)
            // Note: K8s sets QDRANT_PORT to 'tcp://ip:port' format, use QDRANT_SERVICE_PORT_HTTP instead
            qdrantHost: process.env.QDRANT_HOST || 'qdrant.minecraft-ai.svc.cluster.local',
            qdrantPort: process.env.QDRANT_SERVICE_PORT_HTTP || 6333,
            // Working Memory (Redis)
            redisHost: process.env.REDIS_HOST || 'redis-master.minecraft-ai.svc.cluster.local',
            redisPort: process.env.REDIS_PORT || 6379,
            // Semantic Memory (MongoDB)
            mongoHost: process.env.MONGO_HOST || 'mongodb.minecraft-ai.svc.cluster.local',
            mongoPort: process.env.MONGO_PORT || 27017,
            mongoUser: process.env.MONGO_USER || 'mindcraft',
            mongoPassword: process.env.MONGO_PASSWORD || 'mindcraft_user_2026',
            // Embeddings
            geminiApiKey: process.env.GEMINI_API_KEY
        });
        await this.persistentMemory.initialize();

        // Alias para compatibilidad con código que usa agent.memory
        this.memory = this.persistentMemory;

        // load mem first before doing task
        let save_data = null;
        if (load_mem) {
            save_data = this.history.load();
        }
        let taskStart = null;
        if (save_data) {
            taskStart = save_data.taskStart;
        } else {
            taskStart = Date.now();
        }
        this.task = new Task(this, settings.task, taskStart);
        this.blocked_actions = settings.blocked_actions.concat(this.task.blocked_actions || []);
        blacklistCommands(this.blocked_actions);

        console.log(this.name, 'logging into minecraft...');
        this.bot = initBot(this.name);
        
        // Connection Handler
        const onDisconnect = (event, reason) => {
            if (this._disconnectHandled) return;
            this._disconnectHandled = true;

            // Log and Analyze
            // handleDisconnection handles logging to console and server
            const { type } = handleDisconnection(this.name, reason);
     
            process.exit(1);
        };
        
        // Bind events
        this.bot.once('kicked', (reason) => onDisconnect('Kicked', reason));
        this.bot.once('end', (reason) => onDisconnect('Disconnected', reason));
        this.bot.on('error', (err) => {
            if (String(err).includes('Duplicate') || String(err).includes('ECONNREFUSED')) {
                 onDisconnect('Error', err);
            } else {
                 log(this.name, `[LoginGuard] Connection Error: ${String(err)}`);
            }
        });

        initModes(this);

        this.bot.on('login', () => {
            console.log(this.name, 'logged in!');
            serverProxy.login();
            
            // Set skin for profile, requires Fabric Tailor. (https://modrinth.com/mod/fabrictailor)
            if (this.prompter.profile.skin)
                this.bot.chat(`/skin set URL ${this.prompter.profile.skin.model} ${this.prompter.profile.skin.path}`);
            else
                this.bot.chat(`/skin clear`);
        });
		const spawnTimeoutDuration = settings.spawn_timeout;
        const spawnTimeout = setTimeout(() => {
            const msg = `Bot has not spawned after ${spawnTimeoutDuration} seconds. Exiting.`;
            log(this.name, msg);
            process.exit(1);
        }, spawnTimeoutDuration * 1000);
        this.bot.once('spawn', async () => {
            try {
                clearTimeout(spawnTimeout);
                addBrowserViewer(this.bot, count_id);
                console.log('Initializing vision intepreter...');
                this.vision_interpreter = new VisionInterpreter(this, settings.allow_vision);

                // wait for a bit so stats are not undefined
                await new Promise((resolve) => setTimeout(resolve, 1000));
                
                console.log(`${this.name} spawned.`);
                this.clearBotLogs();
              
                this._setupEventHandlers(save_data, init_message);
                this.startEvents();
              
                if (!load_mem) {
                    if (settings.task) {
                        this.task.initBotTask();
                        this.task.setAgentGoal();
                    }
                } else {
                    // set the goal without initializing the rest of the task
                    if (settings.task) {
                        this.task.setAgentGoal();
                    }
                }

                await new Promise((resolve) => setTimeout(resolve, 10000));
                this.checkAllPlayersPresent();

                // Initialize Hybrid Learning System (Voyager-style)
                if (settings.allow_insecure_coding) {
                    try {
                        // Lista completa de todos los bots de la civilización
                        // CRÍTICO: Necesario para que ModeManager no los cuente como jugadores humanos
                        const ALL_CIVILIZATION_BOTS = [
                            'Andy', 'Bruno', 'Carlos', 'Diana', 'Elena',
                            'Felix', 'Gina', 'Hugo', 'Iris', 'Juan'
                        ];

                        integrateHybridSystem(this, {
                            defaultMode: 'hybrid',
                            autonomousDelay: 60000, // 1 minute without players → autonomous
                            useVision: settings.allow_vision,
                            useLLMVerification: true,
                            maxRetries: 3,
                            taskTimeoutMs: 5 * 60 * 1000, // 5 minutes per task
                            botNames: ALL_CIVILIZATION_BOTS  // Usar TODOS los bots, no solo el propio
                        });
                        console.log(`[HybridSystem] Integrated successfully for ${this.name}`);
                        console.log(`[HybridSystem] Bot exclusion list: ${ALL_CIVILIZATION_BOTS.join(', ')}`);
                    } catch (hybridError) {
                        console.error('[HybridSystem] Failed to initialize:', hybridError.message);
                    }
                }

                // Initialize Village Coordination System
                try {
                    await initializeCoordination(this, {
                        redisHost: process.env.REDIS_HOST || 'redis-master',
                        redisPort: process.env.REDIS_PORT || 6379
                    });
                    addCoordinationCommands(this);
                    console.log(`[VillageCoordinator] ${this.name} joined the village`);
                } catch (coordError) {
                    console.error('[VillageCoordinator] Failed to initialize:', coordError.message);
                }

            } catch (error) {
                console.error('Error in spawn event:', error);
                process.exit(1);
            }
        });
    }

    async _setupEventHandlers(save_data, init_message) {
        const ignore_messages = [
            "Set own game mode to",
            "Set the time to",
            "Set the difficulty to",
            "Teleported ",
            "Set the weather to",
            "Gamerule "
        ];
        
        const respondFunc = async (username, message) => {
            if (message === "") return;
            if (username === this.name) return;
            if (settings.only_chat_with.length > 0 && !settings.only_chat_with.includes(username)) return;
            try {
                if (ignore_messages.some((m) => message.startsWith(m))) return;

                this.shut_up = false;

                console.log(this.name, 'received message from', username, ':', message);

                if (convoManager.isOtherAgent(username)) {
                    console.warn('received whisper from other bot??')
                }
                else {
                    let translation = await handleEnglishTranslation(message);
                    this.handleMessage(username, translation);
                }
            } catch (error) {
                console.error('Error handling message:', error);
            }
        }

		this.respondFunc = respondFunc;

        this.bot.on('whisper', respondFunc);
        
        this.bot.on('chat', (username, message) => {
            if (serverProxy.getNumOtherAgents() > 0) return;
            // only respond to open chat messages when there are no other agents
            respondFunc(username, message);
        });

        // Set up auto-eat
        this.bot.autoEat.options = {
            priority: 'foodPoints',
            startAt: 14,
            bannedFood: ["rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish", "chicken"]
        };

        if (save_data?.self_prompt) {
            if (init_message) {
                this.history.add('system', init_message);
            }
            await this.self_prompter.handleLoad(save_data.self_prompt, save_data.self_prompting_state);
        }
        if (save_data?.last_sender) {
            this.last_sender = save_data.last_sender;
            if (convoManager.otherAgentInGame(this.last_sender)) {
                const msg_package = {
                    message: `You have restarted and this message is auto-generated. Continue the conversation with me.`,
                    start: true
                };
                convoManager.receiveFromBot(this.last_sender, msg_package);
            }
        }
        else if (init_message) {
            await this.handleMessage('system', init_message, 2);
        }
        else {
            this.openChat("Hello world! I am "+this.name);
        }
    }

    checkAllPlayersPresent() {
        if (!this.task || !this.task.agent_names) {
          return;
        }

        const missingPlayers = this.task.agent_names.filter(name => !this.bot.players[name]);
        if (missingPlayers.length > 0) {
            console.log(`Missing players/bots: ${missingPlayers.join(', ')}`);
            this.cleanKill('Not all required players/bots are present in the world. Exiting.', 4);
        }
    }

    requestInterrupt() {
        this.bot.interrupt_code = true;
        this.bot.stopDigging();
        this.bot.collectBlock.cancelTask();
        this.bot.pathfinder.stop();
        this.bot.pvp.stop();
    }

    clearBotLogs() {
        this.bot.output = '';
        this.bot.interrupt_code = false;
    }

    shutUp() {
        this.shut_up = true;
        if (this.self_prompter.isActive()) {
            this.self_prompter.stop(false);
        }
        convoManager.endAllConversations();
    }

    async handleMessage(source, message, max_responses=null) {
        await this.checkTaskDone();
        if (!source || !message) {
            console.warn('Received empty message from', source);
            return false;
        }

        let used_command = false;
        if (max_responses === null) {
            max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
        }
        if (max_responses === -1) {
            max_responses = Infinity;
        }

        const self_prompt = source === 'system' || source === this.name;
        const from_other_bot = convoManager.isOtherAgent(source);

        if (!self_prompt && !from_other_bot) { // from user, check for forced commands
            const user_command_name = containsCommand(message);
            if (user_command_name) {
                if (!commandExists(user_command_name)) {
                    this.routeResponse(source, `Command '${user_command_name}' does not exist.`);
                    return false;
                }
                this.routeResponse(source, `*${source} used ${user_command_name.substring(1)}*`);
                if (user_command_name === '!newAction') {
                    // all user-initiated commands are ignored by the bot except for this one
                    // add the preceding message to the history to give context for newAction
                    this.history.add(source, message);
                }
                let execute_res = await executeCommand(this, message);
                if (execute_res) 
                    this.routeResponse(source, execute_res);
                return true;
            }
        }

        if (from_other_bot)
            this.last_sender = source;

        // Now translate the message
        message = await handleEnglishTranslation(message);
        console.log('received message from', source, ':', message);

        const checkInterrupt = () => this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up || convoManager.responseScheduledFor(source);
        
        let behavior_log = this.bot.modes.flushBehaviorLog().trim();
        if (behavior_log.length > 0) {
            const MAX_LOG = 500;
            if (behavior_log.length > MAX_LOG) {
                behavior_log = '...' + behavior_log.substring(behavior_log.length - MAX_LOG);
            }
            behavior_log = 'Recent behaviors log: \n' + behavior_log;
            await this.history.add('system', behavior_log);
        }

        // Handle other user messages
        await this.history.add(source, message);
        this.history.save();

        // Store in persistent memory if from a player
        if (!self_prompt && this.persistentMemory?.initialized) {
            await this.persistentMemory.addMessage(source, message, 'chat');

            // Update player context in Working Memory
            const player = this.bot.players[source];
            if (player) {
                await this.persistentMemory.updateContext({
                    playerName: source,
                    playerContext: {
                        lastMessage: message,
                        position: player.entity?.position ? {
                            x: Math.floor(player.entity.position.x),
                            y: Math.floor(player.entity.position.y),
                            z: Math.floor(player.entity.position.z)
                        } : null,
                        gameMode: player.gamemode
                    }
                });

                // Set attention to this player
                await this.persistentMemory.updateContext({
                    attention: source,
                    attentionType: 'entity'
                });

                // Update player relationship in Semantic Memory
                if (this.persistentMemory?.semantic) {
                    await this.persistentMemory.semantic.updatePlayerRelation(source, {
                        trust: 5, // neutral default, will be modified based on interactions
                        notes: `Last message: ${message.substring(0, 100)}`,
                        tags: ['player']
                    });
                }
            }
        }

        if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
            max_responses = 1; // force only respond to this message, then let self-prompting take over
        for (let i=0; i<max_responses; i++) {
            if (checkInterrupt()) break;
            let history = this.history.getHistory();
            let res = await this.prompter.promptConvo(history);

            console.log(`${this.name} full response to ${source}: ""${res}""`);

            if (res.trim().length === 0) {
                console.warn('no response')
                break; // empty response ends loop
            }

            let command_name = containsCommand(res);

            if (command_name) { // contains query or command
                res = truncCommandMessage(res); // everything after the command is ignored
                this.history.add(this.name, res);
                
                if (!commandExists(command_name)) {
                    this.history.add('system', `Command ${command_name} does not exist.`);
                    console.warn('Agent hallucinated command:', command_name)
                    continue;
                }

                if (checkInterrupt()) break;
                this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));

                if (settings.show_command_syntax === "full") {
                    this.routeResponse(source, res);
                }
                else if (settings.show_command_syntax === "shortened") {
                    // show only "used !commandname"
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    let chat_message = `*used ${command_name.substring(1)}*`;
                    if (pre_message.length > 0)
                        chat_message = `${pre_message}  ${chat_message}`;
                    this.routeResponse(source, chat_message);
                }
                else {
                    // no command at all
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    if (pre_message.trim().length > 0)
                        this.routeResponse(source, pre_message);
                }

                let execute_res = await executeCommand(this, res);

                console.log('Agent executed:', command_name, 'and got:', execute_res);
                used_command = true;

                // Store action result as episodic memory (autonomous)
                if (execute_res && this.persistentMemory?.initialized) {
                    const actionMemory = `I executed ${command_name}: ${execute_res}`;
                    const importance = this._calculateActionImportance(command_name, execute_res);

                    // Only store significant actions (importance >= 5)
                    if (importance >= 5) {
                        const pos = this.bot.entity?.position;
                        await this.persistentMemory.remember(actionMemory, {
                            type: 'action',
                            importance: importance,
                            location: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null,
                            gameTime: this.bot.time?.timeOfDay
                        });
                        console.log(`[Memory] Stored action: ${actionMemory.substring(0, 50)}...`);
                    }

                    // SEMANTIC LEARNING: Learn from successful actions
                    await this._learnFromAction(command_name, res, execute_res);
                }

                if (execute_res)
                    this.history.add('system', execute_res);
                else
                    break;
            }
            else { // conversation response
                this.history.add(this.name, res);
                this.routeResponse(source, res);
                break;
            }
            
            this.history.save();
        }

        return used_command;
    }

    async routeResponse(to_player, message) {
        if (this.shut_up) return;
        let self_prompt = to_player === 'system' || to_player === this.name;
        if (self_prompt && this.last_sender) {
            // this is for when the agent is prompted by system while still in conversation
            // so it can respond to events like death but be routed back to the last sender
            to_player = this.last_sender;
        }

        if (convoManager.isOtherAgent(to_player) && convoManager.inConversation(to_player)) {
            // if we're in an ongoing conversation with the other bot, send the response to it
            convoManager.sendToBot(to_player, message);
        }
        else {
            // otherwise, use open chat
            this.openChat(message);
            // note that to_player could be another bot, but if we get here the conversation has ended
        }
    }

    async openChat(message) {
        let to_translate = message;
        let remaining = '';
        let command_name = containsCommand(message);
        let translate_up_to = command_name ? message.indexOf(command_name) : -1;
        if (translate_up_to != -1) { // don't translate the command
            to_translate = to_translate.substring(0, translate_up_to);
            remaining = message.substring(translate_up_to);
        }
        message = (await handleTranslation(to_translate)).trim() + " " + remaining;
        // newlines are interpreted as separate chats, which triggers spam filters. replace them with spaces
        message = message.replaceAll('\n', ' ');

        if (settings.only_chat_with.length > 0) {
            for (let username of settings.only_chat_with) {
                this.bot.whisper(username, message);
            }
        }
        else {
            if (settings.speak) {
                speak(to_translate, this.prompter.profile.speak_model);
            }
            if (settings.chat_ingame) {this.bot.chat(message);}
            sendOutputToServer(this.name, message);
        }
    }

    startEvents() {
        // Custom events
        this.bot.on('time', () => {
            if (this.bot.time.timeOfDay == 0)
            this.bot.emit('sunrise');
            else if (this.bot.time.timeOfDay == 6000)
            this.bot.emit('noon');
            else if (this.bot.time.timeOfDay == 12000)
            this.bot.emit('sunset');
            else if (this.bot.time.timeOfDay == 18000)
            this.bot.emit('midnight');
        });

        // Autonomous time-based observations
        this.bot.on('sunrise', async () => {
            if (this.persistentMemory?.initialized && Math.random() < 0.3) { // 30% chance to record
                const pos = this.bot.entity?.position;
                const biome = this.bot.world?.getBiome?.(pos) || 'unknown';
                await this.persistentMemory.remember(
                    `A new day begins. I'm at ${Math.floor(pos?.x)}, ${Math.floor(pos?.y)}, ${Math.floor(pos?.z)} in ${biome}.`,
                    { type: 'observation', importance: 3 }
                );
            }
        });

        this.bot.on('sunset', async () => {
            if (this.persistentMemory?.initialized && Math.random() < 0.3) {
                await this.persistentMemory.remember(
                    `The sun is setting. I should find shelter or prepare for night.`,
                    { type: 'observation', importance: 4 }
                );
            }
        });

        let prev_health = this.bot.health;
        this.bot.lastDamageTime = 0;
        this.bot.lastDamageTaken = 0;
        this.bot.on('health', async () => {
            if (this.bot.health < prev_health) {
                this.bot.lastDamageTime = Date.now();
                this.bot.lastDamageTaken = prev_health - this.bot.health;

                // Store significant damage as memory
                if (this.persistentMemory?.initialized && this.bot.lastDamageTaken >= 4) {
                    const pos = this.bot.entity?.position;
                    await this.persistentMemory.remember(
                        `I took ${this.bot.lastDamageTaken.toFixed(1)} damage! Health now: ${this.bot.health.toFixed(1)}/20`,
                        {
                            type: 'damage',
                            importance: this.bot.health < 6 ? 8 : 5,
                            location: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null
                        }
                    );
                }
            }
            prev_health = this.bot.health;
        });
        // Track inventory for rare item discoveries
        this._lastInventoryCheck = new Set();
        this.bot.on('playerCollect', async (collector, collected) => {
            if (collector.username !== this.bot.username) return;

            // Check for rare items
            const rareItems = ['diamond', 'emerald', 'ancient_debris', 'netherite', 'elytra', 'totem', 'enchanted_golden_apple'];
            const itemName = collected.getDroppedItem?.()?.name || '';

            if (this.persistentMemory?.initialized && rareItems.some(rare => itemName.includes(rare))) {
                const pos = this.bot.entity?.position;
                await this.persistentMemory.remember(
                    `I found a rare item: ${itemName} at ${Math.floor(pos?.x)}, ${Math.floor(pos?.y)}, ${Math.floor(pos?.z)}!`,
                    {
                        type: 'discovery',
                        importance: 9,
                        location: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null
                    }
                );
                console.log(`[Memory] DISCOVERY: Found ${itemName}!`);
            }
        });

        // Logging callbacks
        this.bot.on('error' , (err) => {
            console.error('Error event!', err);
        });
        // Use connection handler for runtime disconnects
        this.bot.on('end', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('death', () => {
            this.actions.cancelResume();
            this.actions.stop();
        });
        this.bot.on('kicked', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            if (jsonMsg.translate && jsonMsg.translate.startsWith('death') && message.startsWith(this.name)) {
                console.log('Agent died: ', message);
                let death_pos = this.bot.entity.position;
                this.memory_bank.rememberPlace('last_death_position', death_pos.x, death_pos.y, death_pos.z);
                let death_pos_text = null;
                if (death_pos) {
                    death_pos_text = `x: ${death_pos.x.toFixed(2)}, y: ${death_pos.y.toFixed(2)}, z: ${death_pos.z.toFixed(2)}`;
                }
                let dimention = this.bot.game.dimension;

                // Store death as important memory
                if (this.persistentMemory?.initialized) {
                    await this.persistentMemory.remember(
                        `I died at ${death_pos_text} in ${dimention}. Death message: ${message}`,
                        {
                            type: 'death',
                            importance: 9,
                            location: death_pos ? { x: death_pos.x, y: death_pos.y, z: death_pos.z } : null
                        }
                    );
                }

                this.handleMessage('system', `You died at position ${death_pos_text || "unknown"} in the ${dimention} dimension with the final message: '${message}'. Your place of death is saved as 'last_death_position' if you want to return. Previous actions were stopped and you have respawned.`);
            }
        });
        this.bot.on('idle', () => {
            this.bot.clearControlStates();
            this.bot.pathfinder.stop(); // clear any lingering pathfinder
            this.bot.modes.unPauseAll();
            setTimeout(() => {
                if (this.isIdle()) {
                    this.actions.resumeAction();
                }
            }, 1000);
        });

        // Init NPC controller
        this.npc.init();

        // This update loop ensures that each update() is called one at a time, even if it takes longer than the interval
        const INTERVAL = 300;
        let last = Date.now();
        setTimeout(async () => {
            while (true) {
                let start = Date.now();
                await this.update(start - last);
                let remaining = INTERVAL - (Date.now() - start);
                if (remaining > 0) {
                    await new Promise((resolve) => setTimeout(resolve, remaining));
                }
                last = start;
            }
        }, INTERVAL);

        this.bot.emit('idle');
    }

    async update(delta) {
        await this.bot.modes.update();
        this.self_prompter.update(delta);
        await this.checkTaskDone();

        // Periodic autonomous world observation (every ~5 minutes on average)
        if (this.persistentMemory?.initialized) {
            this._observationTimer = (this._observationTimer || 0) + delta;

            // ~5 minutes = 300000ms, check every update (300ms) with small probability
            if (this._observationTimer > 300000 && Math.random() < 0.1) {
                this._observationTimer = 0;
                await this._recordWorldObservation();
            }

            // Update Working Memory with current state (every 30 seconds)
            this._workingMemoryTimer = (this._workingMemoryTimer || 0) + delta;
            if (this._workingMemoryTimer > 30000) {
                this._workingMemoryTimer = 0;
                await this._updateWorkingMemory();
            }
        }
    }

    /**
     * Update Working Memory (Redis) with current bot state
     */
    async _updateWorkingMemory() {
        if (!this.persistentMemory?.initialized) return;

        try {
            const pos = this.bot.entity?.position;
            const health = this.bot.health;
            const food = this.bot.food;
            const gameTime = this.bot.time?.timeOfDay;

            // Update game state
            await this.persistentMemory.updateContext({
                gameState: {
                    position: pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null,
                    health: health,
                    food: food,
                    gameTime: gameTime,
                    dimension: this.bot.game?.dimension,
                    isRaining: this.bot.isRaining,
                    executing: this.actions.executing
                }
            });

            // Update current goal from self_prompter
            if (this.self_prompter.isActive() && this.self_prompter.prompt) {
                await this.persistentMemory.updateContext({
                    goal: this.self_prompter.prompt,
                    goalPriority: 7
                });
            }

            // Update attention based on current action target
            if (this.actions.executing && this.bot.pathfinder?.goal) {
                const goal = this.bot.pathfinder.goal;
                await this.persistentMemory.updateContext({
                    attention: `Moving to ${goal.x?.toFixed(0)}, ${goal.y?.toFixed(0)}, ${goal.z?.toFixed(0)}`,
                    attentionType: 'location'
                });
            }

            console.log('[WorkingMemory] State updated in Redis');
        } catch (error) {
            console.error('[WorkingMemory] Failed to update state:', error.message);
        }
    }

    /**
     * Record an autonomous observation about the current world state
     */
    async _recordWorldObservation() {
        if (!this.persistentMemory?.initialized) return;

        try {
            const pos = this.bot.entity?.position;
            if (!pos) return;

            // Get nearby entities
            const nearbyEntities = Object.values(this.bot.entities || {})
                .filter(e => e.position?.distanceTo(pos) < 16 && e.type !== 'object')
                .map(e => e.name || e.username || e.type)
                .slice(0, 5);

            // Get nearby blocks of interest
            const interestingBlocks = [];
            const blockTypes = ['diamond_ore', 'emerald_ore', 'ancient_debris', 'spawner', 'chest'];

            for (const blockType of blockTypes) {
                const block = this.bot.findBlock({
                    matching: b => b?.name?.includes(blockType.split('_')[0]),
                    maxDistance: 16
                });
                if (block) {
                    interestingBlocks.push(block.name);
                }
            }

            // Only store if something interesting
            if (nearbyEntities.length > 0 || interestingBlocks.length > 0) {
                let observation = `I'm at ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}.`;

                if (nearbyEntities.length > 0) {
                    observation += ` Nearby: ${nearbyEntities.join(', ')}.`;
                }

                if (interestingBlocks.length > 0) {
                    observation += ` Noticed: ${interestingBlocks.join(', ')}.`;
                }

                await this.persistentMemory.remember(observation, {
                    type: 'observation',
                    importance: interestingBlocks.length > 0 ? 7 : 4,
                    location: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
                    entities: nearbyEntities
                });

                console.log(`[Memory] Observation: ${observation.substring(0, 60)}...`);
            }
        } catch (e) {
            // Silent fail for observations
        }
    }

    isIdle() {
        return !this.actions.executing;
    }
    

    cleanKill(msg='Killing agent process...', code=1) {
        this.history.add('system', msg);
        this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.');
        this.history.save();
        process.exit(code);
    }
    async checkTaskDone() {
        if (this.task.data) {
            let res = this.task.isDone();
            if (res) {
                await this.history.add('system', `Task ended with score : ${res.score}`);
                await this.history.save();
                // await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 second for save to complete
                console.log('Task finished:', res.message);
                this.killAll();
            }
        }
    }

    killAll() {
        serverProxy.shutdown();
    }

    /**
     * Calculate importance score for an action result (for autonomous memory storage)
     * High importance: rare items, significant achievements, failures
     * Low importance: routine actions
     */
    _calculateActionImportance(commandName, result) {
        let score = 4; // Base score

        const resultLower = result.toLowerCase();

        // High importance items/events
        const highImportance = [
            'diamond', 'emerald', 'ancient_debris', 'netherite',
            'enchanted', 'elytra', 'totem', 'beacon',
            'failed', 'error', 'cannot', 'not enough',
            'died', 'killed', 'defeated'
        ];

        // Medium importance
        const mediumImportance = [
            'iron', 'gold', 'redstone', 'lapis',
            'crafted', 'built', 'placed', 'completed',
            'found', 'discovered', 'reached'
        ];

        // Low importance (routine)
        const lowImportance = [
            'dirt', 'cobblestone', 'wood', 'stone',
            'walking', 'moving', 'looking'
        ];

        // Adjust score based on content
        for (const word of highImportance) {
            if (resultLower.includes(word)) {
                score += 3;
                break;
            }
        }

        for (const word of mediumImportance) {
            if (resultLower.includes(word)) {
                score += 1;
                break;
            }
        }

        for (const word of lowImportance) {
            if (resultLower.includes(word)) {
                score -= 2;
                break;
            }
        }

        // Commands that are inherently more important
        const importantCommands = ['!newAction', '!craftRecipe', '!smeltItem', '!placeBlock'];
        if (importantCommands.some(cmd => commandName.includes(cmd))) {
            score += 1;
        }

        return Math.max(1, Math.min(10, score));
    }

    /**
     * Learn from successful actions - populates Semantic and Procedural memory
     */
    async _learnFromAction(commandName, fullCommand, result) {
        if (!this.persistentMemory?.initialized) return;

        try {
            const resultLower = result.toLowerCase();
            const success = !resultLower.includes('failed') &&
                           !resultLower.includes('error') &&
                           !resultLower.includes('cannot') &&
                           !resultLower.includes('not enough');

            // SEMANTIC: Learn recipes from successful crafting
            if (commandName === '!craftRecipe' && success && resultLower.includes('successfully')) {
                const itemMatch = fullCommand.match(/!craftRecipe\s*\(\s*["']([^"']+)["']/);
                if (itemMatch) {
                    const item = itemMatch[1];
                    await this.persistentMemory.learnRecipe(item, {
                        notes: `Learned from successful crafting: ${result.substring(0, 100)}`,
                        requiresCraftingTable: resultLower.includes('crafting_table')
                    });
                    console.log(`[SemanticMemory] Learned recipe for: ${item}`);
                }
            }

            // SEMANTIC: Learn locations from rememberPlace
            if (commandName === '!rememberPlace') {
                const placeMatch = fullCommand.match(/!rememberPlace\s*\(\s*["']([^"']+)["']/);
                if (placeMatch && this.bot.entity?.position) {
                    const name = placeMatch[1];
                    const pos = this.bot.entity.position;
                    await this.persistentMemory.rememberLocation(name, {
                        x: Math.floor(pos.x),
                        y: Math.floor(pos.y),
                        z: Math.floor(pos.z),
                        dimension: this.bot.game?.dimension,
                        tags: ['user_saved']
                    });
                }
            }

            // SEMANTIC: Learn facts from exploration
            if (commandName === '!searchForBlock' && success) {
                const blockMatch = fullCommand.match(/!searchForBlock\s*\(\s*["']([^"']+)["']/);
                if (blockMatch) {
                    const block = blockMatch[1];
                    const coordsMatch = result.match(/at\s*\(?\s*(-?\d+),?\s*(-?\d+),?\s*(-?\d+)/);
                    if (coordsMatch) {
                        await this.persistentMemory.learnFact('mining',
                            `Found ${block} at approximately ${coordsMatch[1]}, ${coordsMatch[2]}, ${coordsMatch[3]}`
                        );
                    }
                }
            }

            // SEMANTIC: Learn mob behaviors from combat
            if ((commandName === '!attack' || commandName === '!kill') && success) {
                const mobMatch = fullCommand.match(/!\w+\s*\(\s*["']([^"']+)["']/);
                if (mobMatch && resultLower.includes('killed')) {
                    const mob = mobMatch[1];
                    await this.persistentMemory.learnMobBehavior(mob, {
                        hostile: true,
                        notes: `Successfully killed. ${result.substring(0, 50)}`
                    });
                    if (this.persistentMemory.semantic?.connected) {
                        await this.persistentMemory.semantic.recordMobEncounter(mob, 'killed');
                    }
                }
            }

            // PROCEDURAL: Learn skills from successful complex actions
            if (commandName === '!newAction' && success) {
                // Extract the action code from the coder
                const actionCode = this.coder?.lastGeneratedCode;
                const actionDescription = fullCommand.replace('!newAction', '').trim();

                if (actionCode && actionDescription) {
                    const skillName = `action_${Date.now()}`;
                    await this.persistentMemory.learnSkill(
                        skillName,
                        actionDescription,
                        actionCode,
                        [] // preconditions would need more analysis
                    );
                    console.log(`[ProceduralMemory] Learned skill: ${skillName}`);
                }
            }

        } catch (error) {
            // Silent fail for learning - don't interrupt gameplay
            console.error('[Memory] Learning failed:', error.message);
        }
    }
}