#!/bin/bash
# Start Andy bot with Persistent Memory System
# Connects to Qdrant and Redis in Kubernetes

# Load NVM
source ~/.nvm/nvm.sh
nvm use 20

# Environment variables for 4-layer memory system
# 1. Episodic + Procedural (Qdrant)
export QDRANT_HOST="10.108.195.33"
export QDRANT_PORT="6333"
# 2. Working Memory (Redis)
export REDIS_HOST="10.107.152.7"
export REDIS_PORT="6379"
# 3. Semantic Memory (MongoDB)
export MONGO_HOST="10.103.13.167"
export MONGO_PORT="27017"
export MONGO_USER="mindcraft"
export MONGO_PASSWORD="mindcraft_user_2026"
# Embeddings
export GEMINI_API_KEY="AIzaSyBJroTxr2iN8yXbx_jhPomgKrMGSmTZLwU"

# Change to mindcraft directory
cd /home/pablo/mindcraft-ce

# Start the bot
echo "Starting Andy with 4-Layer Memory System..."
echo "1. Episodic/Procedural (Qdrant): $QDRANT_HOST:$QDRANT_PORT"
echo "2. Working (Redis): $REDIS_HOST:$REDIS_PORT"
echo "3. Semantic (MongoDB): $MONGO_HOST:$MONGO_PORT"

node main.js
