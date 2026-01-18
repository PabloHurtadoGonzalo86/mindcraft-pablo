const settings = {
    "minecraft_version": "1.21.1", // Matching server version
    "host": "127.0.0.1", // localhost for Kubernetes NodePort
    "port": 30566, // NodePort for Minecraft server in K8s
    "auth": "offline", // server is in offline mode

    // the mindserver manages all agents and hosts the UI
    "mindserver_port": 8080,
    "auto_open_ui": false, // disabled for server environment

    "base_profile": "survival", // survival mode for autonomous agent
    "profiles": [
        // === MINECRAFT AI CIVILIZATION - 10 BOTS ===
        "./bots/andy-leader.json",      // Andy - Village Leader
        "./bots/bruno-miner.json",      // Bruno - Miner (ores, underground)
        "./bots/carlos-lumberjack.json", // Carlos - Lumberjack (wood)
        "./bots/diana-farmer.json",     // Diana - Farmer (food)
        "./bots/elena-builder.json",    // Elena - Builder (construction)
        "./bots/felix-crafter.json",    // Felix - Crafter (tools, items)
        "./bots/gina-explorer.json",    // Gina - Explorer (scouting)
        "./bots/hugo-guard.json",       // Hugo - Guard (defense)
        "./bots/iris-merchant.json",    // Iris - Merchant (trade, resources)
        "./bots/juan-smith.json",       // Juan - Smith (smelting, armor)

        // Note: All bots share the same Gemini API key and memory systems
        // They coordinate via Redis pub/sub (VillageCoordinator)
    ],

    "load_memory": true, // enable memory persistence
    "init_message": "I'm online and ready to work with the village!", // sends to all on spawn
    "only_chat_with": [], // users that the bots listen to and send general messages to. if empty it will chat publicly

    "speak": false,
    // allows all bots to speak through text-to-speech. 
    // specify speech model inside each profile with format: {provider}/{model}/{voice}.
    // if set to "system" it will use basic system text-to-speech. 
    // Works on windows and mac, but linux requires you to install the espeak package through your package manager eg: `apt install espeak` `pacman -S espeak`.

    "chat_ingame": true, // bot responses are shown in minecraft chat
    "language": "en", // translate to/from this language. Supports these language names: https://cloud.google.com/translate/docs/languages
    "render_bot_view": false, // show bot's view in browser at localhost:3000, 3001...

    "allow_insecure_coding": true, // ENABLED: allows newAction for hybrid learning system
    "allow_vision": false, // DISABLED: WebGL not available in headless Docker
    "blocked_actions" : ["!checkBlueprint", "!checkBlueprintLevel", "!getBlueprint", "!getBlueprintLevel"] , // commands to disable and remove from docs. Ex: ["!setMode"]
    "code_timeout_mins": 10, // 10 minutes timeout for generated code
    "relevant_docs_count": 5, // number of relevant code function docs to select for prompting. -1 for all

    "max_messages": 15, // max number of messages to keep in context
    "num_examples": 2, // number of examples to give to the model
    "max_commands": -1, // max number of commands that can be used in consecutive responses. -1 for no limit
    "show_command_syntax": "full", // "full", "shortened", or "none"
    "narrate_behavior": true, // chat simple automatic actions ('Picking up item!')
    "chat_bot_messages": true, // publicly chat messages to other bots

    "spawn_timeout": 30, // num seconds allowed for the bot to spawn before throwing error. Increase when spawning takes a while.
    "block_place_delay": 0, // delay between placing blocks (ms) if using newAction. helps avoid bot being kicked by anti-cheat mechanisms on servers.
  
    "log_all_prompts": false, // log ALL prompts to file

}

if (process.env.SETTINGS_JSON) {
    try {
        Object.assign(settings, JSON.parse(process.env.SETTINGS_JSON));
    } catch (err) {
        console.error("Failed to parse SETTINGS_JSON:", err);
    }
}

export default settings;
