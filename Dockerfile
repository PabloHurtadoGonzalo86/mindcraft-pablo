# Mindcraft Bot with 4-Layer Memory System
FROM node:20-slim

# Install dependencies for canvas and other native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Create bots directory for memory persistence
RUN mkdir -p /app/bots/Andy

# Environment variables (will be overridden by K8s)
ENV QDRANT_HOST=qdrant
ENV QDRANT_PORT=6333
ENV REDIS_HOST=redis-master
ENV REDIS_PORT=6379
ENV MONGO_HOST=mongodb
ENV MONGO_PORT=27017

# Start the bot
CMD ["node", "main.js"]
