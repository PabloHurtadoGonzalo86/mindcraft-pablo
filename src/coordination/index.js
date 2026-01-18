/**
 * Village Coordination System - Main Entry Point
 *
 * Integrates village coordination into Mindcraft agents
 */

import { VillageCoordinator, ROLES } from './village_coordinator.js';

let coordinatorInstance = null;

/**
 * Initialize village coordination for an agent
 */
export async function initializeCoordination(agent, config = {}) {
    if (coordinatorInstance) {
        console.log('[Coordination] Already initialized');
        return coordinatorInstance;
    }

    const coordinator = new VillageCoordinator(agent.name, config);

    const success = await coordinator.initialize();
    if (!success) {
        console.error('[Coordination] Failed to initialize');
        return null;
    }

    // Set up event handlers
    coordinator.onTaskAssigned = (task) => {
        // Send task to agent as a system message
        const message = `[VILLAGE TASK] ${task.assignedBy} assigned you: ${task.description}`;
        agent.history.add('system', message);

        // Optionally auto-execute if it's a direct command
        if (task.description.includes('!')) {
            agent.handleMessage('system', task.description);
        }
    };

    coordinator.onAlert = (alert) => {
        // Forward alerts to agent
        const message = `[VILLAGE ALERT] ${alert.from}: ${alert.message}`;

        // For danger alerts, prioritize response
        if (alert.type === 'danger' && agent.name === 'Hugo') {
            // Guard should respond to danger
            agent.handleMessage('system', message);
        } else {
            agent.history.add('system', message);
        }
    };

    // Store reference in agent
    agent.coordinator = coordinator;
    coordinatorInstance = coordinator;

    console.log(`[Coordination] ${agent.name} joined the village`);

    return coordinator;
}

/**
 * Get the coordinator instance
 */
export function getCoordinator() {
    return coordinatorInstance;
}

/**
 * Add coordination commands to the agent
 */
export function addCoordinationCommands(agent) {
    const originalHandleMessage = agent.handleMessage.bind(agent);

    agent.handleMessage = async function(source, message, max_responses) {
        const lowerMessage = message.toLowerCase().trim();

        // !village status - Show village status
        if (lowerMessage === '!village status' || lowerMessage === '!village') {
            if (!agent.coordinator) {
                agent.openChat('Village coordination not initialized');
                return;
            }

            const bots = await agent.coordinator.getOnlineBots();
            agent.openChat(`Village Status: ${bots.length} bots online`);
            bots.slice(0, 5).forEach(b => {
                agent.openChat(`- ${b.name} (${b.role}): ${b.status}`);
            });
            return;
        }

        // !village task <bot> <description> - Assign task
        if (lowerMessage.startsWith('!village task ')) {
            if (!agent.coordinator) {
                agent.openChat('Village coordination not initialized');
                return;
            }

            const parts = message.substring(14).split(' ');
            const targetBot = parts[0];
            const taskDesc = parts.slice(1).join(' ');

            if (taskDesc) {
                await agent.coordinator.assignTask(taskDesc, targetBot);
                agent.openChat(`Task assigned to ${targetBot}: ${taskDesc}`);
            }
            return;
        }

        // !village alert <message> - Send alert
        if (lowerMessage.startsWith('!village alert ')) {
            if (!agent.coordinator) {
                agent.openChat('Village coordination not initialized');
                return;
            }

            const alertMessage = message.substring(15);
            await agent.coordinator.sendAlert(alertMessage, 'warning');
            agent.openChat(`Alert sent: ${alertMessage}`);
            return;
        }

        // !village help - Request help
        if (lowerMessage.startsWith('!village help ')) {
            if (!agent.coordinator) {
                agent.openChat('Village coordination not initialized');
                return;
            }

            const helpMessage = message.substring(14);
            await agent.coordinator.requestHelp(helpMessage);
            agent.openChat(`Help requested: ${helpMessage}`);
            return;
        }

        // Pass to original handler
        return originalHandleMessage(source, message, max_responses);
    };
}

export { VillageCoordinator, ROLES };
export default initializeCoordination;
