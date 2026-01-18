import { spawn } from 'child_process';
import { logoutAgent } from '../mindcraft/mindserver.js';

export class AgentProcess {
    constructor(name, port) {
        this.name = name;
        this.port = port;
        this.restartAttempts = 0;
        this.maxRestartAttempts = 10;
    }

    start(load_memory=false, init_message=null, count_id=0) {
        this.count_id = count_id;
        this.running = true;

        let args = ['src/process/init_agent.js', this.name];
        args.push('-n', this.name);
        args.push('-c', count_id);
        if (load_memory)
            args.push('-l', load_memory);
        if (init_message)
            args.push('-m', init_message);
        args.push('-p', this.port);

        const agentProcess = spawn('node', args, {
            stdio: 'inherit',
            stderr: 'inherit',
        });

        let last_restart = Date.now();
        agentProcess.on('exit', (code, signal) => {
            console.log(`Agent ${this.name} process exited with code ${code} and signal ${signal}`);
            this.running = false;
            logoutAgent(this.name);

            if (code > 1) {
                console.log(`Ending task`);
                process.exit(code);
            }

            if (code !== 0 && signal !== 'SIGINT') {
                // Check if process ran long enough (30 seconds minimum)
                const runTime = Date.now() - last_restart;
                if (runTime < 30000) {
                    this.restartAttempts++;
                    if (this.restartAttempts >= this.maxRestartAttempts) {
                        console.error(`Agent ${this.name} exceeded max restart attempts (${this.maxRestartAttempts}). Giving up.`);
                        return;
                    }
                    // Exponential backoff: 5s, 10s, 20s, 40s... up to 5 minutes
                    const baseDelay = 5000;
                    const maxDelay = 300000;
                    const delay = Math.min(baseDelay * Math.pow(2, this.restartAttempts), maxDelay);
                    // Add random jitter (0-30%) to prevent thundering herd
                    const jitter = delay * Math.random() * 0.3;
                    const totalDelay = delay + jitter;
                    console.log(`Agent ${this.name} exited too quickly (${runTime}ms). Waiting ${Math.round(totalDelay/1000)}s before restart (attempt ${this.restartAttempts}/${this.maxRestartAttempts})...`);
                    setTimeout(() => {
                        console.log(`Restarting agent ${this.name}...`);
                        this.start(true, 'Agent process restarted.', this.count_id);
                        last_restart = Date.now();
                    }, totalDelay);
                    return;
                }
                // Reset restart attempts on successful long run
                this.restartAttempts = 0;
                console.log(`Restarting agent ${this.name}...`);
                this.start(true, 'Agent process restarted.', this.count_id);
                last_restart = Date.now();
            }
        });
    
        agentProcess.on('error', (err) => {
            console.error('Agent process error:', err);
        });

        this.process = agentProcess;
    }

    stop() {
        if (!this.running) return;
        this.process.kill('SIGINT');
    }

    forceRestart() {
        // Reset restart attempts on manual force restart
        this.restartAttempts = 0;
        if (this.running && this.process && !this.process.killed) {
            console.log(`Agent process for ${this.name} is still running. Attempting to force restart.`);

            const restartTimeout = setTimeout(() => {
                console.warn(`Agent ${this.name} did not stop in time. It might be stuck.`);
            }, 5000); // 5 seconds to exit

            this.process.once('exit', () => {
                 clearTimeout(restartTimeout);
                 console.log(`Stopped hanging agent ${this.name}. Now restarting.`);
                 this.start(true, 'Agent process restarted.', this.count_id);
            });
            this.stop(); // sends SIGINT
        } else {
             this.start(true, 'Agent process restarted.', this.count_id);
        }
    }

    /**
     * Reset restart attempts counter - useful when manually intervening
     */
    resetRestartAttempts() {
        this.restartAttempts = 0;
    }
}