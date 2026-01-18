# Mindcraft-CE: AI Civilization Project

## Project Overview

This is a fork of [Mindcraft](https://github.com/kolbytn/mindcraft) enhanced with:
- **4-Layer Persistent Memory System** (Episodic, Working, Semantic, Procedural)
- **Hybrid Learning System** (Voyager-style curriculum)
- **10-Bot AI Civilization** with specialized roles
- **Village Coordination System** for inter-bot communication

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  MINECRAFT AI CIVILIZATION                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              10 SPECIALIZED BOTS                      │   │
│  │                                                       │   │
│  │  Andy (Leader) ──┬── Bruno (Miner)                   │   │
│  │                  ├── Carlos (Lumberjack)             │   │
│  │                  ├── Diana (Farmer)                  │   │
│  │                  ├── Elena (Builder)                 │   │
│  │                  ├── Felix (Crafter)                 │   │
│  │                  ├── Gina (Explorer)                 │   │
│  │                  ├── Hugo (Guard)                    │   │
│  │                  ├── Iris (Merchant)                 │   │
│  │                  └── Juan (Smith)                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           VILLAGE COORDINATOR (Redis Pub/Sub)         │   │
│  │  - Task assignment                                    │   │
│  │  - Alert broadcasting                                 │   │
│  │  - Resource tracking                                  │   │
│  │  - Bot status monitoring                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              4-LAYER MEMORY SYSTEM                    │   │
│  │                                                       │   │
│  │  ┌──────────────┐  ┌──────────────┐                 │   │
│  │  │   Episodic   │  │   Working    │                 │   │
│  │  │   (Qdrant)   │  │   (Redis)    │                 │   │
│  │  │  Experiences │  │ Current State│                 │   │
│  │  └──────────────┘  └──────────────┘                 │   │
│  │  ┌──────────────┐  ┌──────────────┐                 │   │
│  │  │   Semantic   │  │  Procedural  │                 │   │
│  │  │  (MongoDB)   │  │   (Qdrant)   │                 │   │
│  │  │Facts/Recipes │  │   Skills     │                 │   │
│  │  └──────────────┘  └──────────────┘                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
mindcraft-ce/
├── bots/                           # Bot profiles
│   ├── andy-leader.json            # Village leader
│   ├── bruno-miner.json            # Mining specialist
│   ├── carlos-lumberjack.json      # Wood collection
│   ├── diana-farmer.json           # Agriculture
│   ├── elena-builder.json          # Construction
│   ├── felix-crafter.json          # Item crafting
│   ├── gina-explorer.json          # Exploration
│   ├── hugo-guard.json             # Defense
│   ├── iris-merchant.json          # Trading
│   └── juan-smith.json             # Metallurgy
├── src/
│   ├── agent/                      # Main agent logic
│   │   └── agent.js                # Agent class with memory integration
│   ├── memory/                     # 4-Layer Memory System
│   │   ├── index.js                # Memory system entry point
│   │   ├── episodic_memory.js      # Qdrant-based experiences
│   │   ├── working_memory.js       # Redis-based current state
│   │   ├── semantic_memory.js      # MongoDB-based knowledge
│   │   └── procedural_memory.js    # Qdrant-based skills
│   ├── hybrid/                     # Hybrid Learning System
│   │   ├── index.js                # Main hybrid system
│   │   ├── curriculum_engine.js    # 31-task progression
│   │   ├── mode_manager.js         # Interactive/Autonomous switching
│   │   ├── success_verifier.js     # Task verification
│   │   └── integration.js          # Easy integration script
│   └── coordination/               # Village Coordination
│       ├── index.js                # Coordination entry point
│       └── village_coordinator.js  # Redis pub/sub coordination
├── k8s/                            # Kubernetes deployments
│   └── mindcraft-civilization.yaml # 10-bot deployment
├── settings.js                     # Main configuration
└── CLAUDE.md                       # This file
```

## Configuration

### settings.js

```javascript
{
    "profiles": [
        "./bots/andy-leader.json",
        "./bots/bruno-miner.json",
        "./bots/carlos-lumberjack.json",
        "./bots/diana-farmer.json",
        "./bots/elena-builder.json",
        "./bots/felix-crafter.json",
        "./bots/gina-explorer.json",
        "./bots/hugo-guard.json",
        "./bots/iris-merchant.json",
        "./bots/juan-smith.json"
    ],
    "allow_insecure_coding": true,  // Required for !newAction
    "allow_vision": false,           // Disabled (no WebGL in Docker)
    "chat_bot_messages": true        // Enable bot-to-bot chat
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Google Gemini API key | Required |
| `QDRANT_HOST` | Qdrant server | `qdrant` |
| `REDIS_HOST` | Redis server | `redis-master` |
| `MONGO_HOST` | MongoDB server | `mongodb` |
| `MONGO_PASSWORD` | MongoDB password | Required |

## Kubernetes Deployment

### Prerequisites
- Kubernetes cluster with Longhorn storage
- Qdrant, Redis, MongoDB deployed
- Secret `mindcraft-secrets` with API keys

### Deploy
```bash
kubectl apply -f k8s/mindcraft-civilization.yaml
```

### Resources Required
- CPU: 3 cores (limit)
- Memory: 4GB (limit)
- Storage: 5GB for bot memories

## Bot Roles & Specializations

| Bot | Role | Primary Tasks |
|-----|------|---------------|
| Andy | Leader | Coordinate village, assign tasks, make decisions |
| Bruno | Miner | Mine ores, dig tunnels, find diamonds |
| Carlos | Lumberjack | Chop trees, collect wood, replant |
| Diana | Farmer | Grow crops, breed animals, make food |
| Elena | Builder | Construct buildings, infrastructure |
| Felix | Crafter | Craft tools, weapons, items |
| Gina | Explorer | Scout terrain, find structures, map world |
| Hugo | Guard | Defend village, fight mobs, patrol |
| Iris | Merchant | Manage resources, trade, organize storage |
| Juan | Smith | Smelt ores, make armor, forge metal |

## Village Commands

In-game chat commands:
- `!village status` - Show village status
- `!village task <bot> <description>` - Assign task to bot
- `!village alert <message>` - Send alert to all bots
- `!village help <description>` - Request help

## Hybrid System Commands

- `!hybrid status` - Show mode and progress
- `!hybrid mode <mode>` - Set mode (interactive/autonomous/hybrid)
- `!hybrid pause` - Pause curriculum
- `!hybrid resume` - Resume curriculum
- `!hybrid next` - Show next tasks

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/docker-build-push.yml`):
- Triggers on push to `pablo-memory-system` branch
- Builds Docker image with all dependencies
- Pushes to `ocholoko888/mindcraft-andy:latest`

## Security Notes

1. **API Keys**: Never commit API keys to git
   - Use Kubernetes secrets
   - Reference via `secretKeyRef` in deployments

2. **Repository**: This repo is PUBLIC
   - Historical commits may contain exposed keys (already revoked)
   - Current secrets are stored only in Kubernetes

3. **MongoDB Password**: Stored in Kubernetes secret
   - Never hardcode in configuration files

## Monitoring

Check logs:
```bash
kubectl logs deployment/mindcraft-civilization -n minecraft-ai -f
```

Expected log messages:
```
[MemorySystem] Episodic (Qdrant):    ✓
[MemorySystem] Working (Redis):      ✓
[MemorySystem] Semantic (MongoDB):   ✓
[MemorySystem] Procedural (Qdrant):  ✓
[VillageCoordinator] Andy joined the village
[HybridSystem] Integrated successfully for Andy
```

## Troubleshooting

### Bots not spawning
- Check Minecraft server is accessible
- Verify `host` and `port` in settings.js

### Memory system errors
- Verify Qdrant, Redis, MongoDB are running
- Check environment variables

### API key issues
- Verify secret exists: `kubectl get secret mindcraft-secrets -n minecraft-ai`
- Check key is valid in Google Cloud Console

## References

- [Original Mindcraft](https://github.com/kolbytn/mindcraft)
- [Voyager (NVIDIA)](https://voyager.minedojo.org/)
- [Project Sid (Altera)](https://arxiv.org/abs/2411.00114)
- [Mineflayer](https://github.com/PrismarineJS/mineflayer)
