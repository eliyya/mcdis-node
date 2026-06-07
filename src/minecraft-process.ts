import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import type { Message, ThreadChannel } from 'discord.js'
import type { ProcessConfig } from './config.js'
import type { DiscordMessageQueue } from './discord-message-queue.js'
import { cleanConsoleLog, formatManagerLog, shouldRelayLog } from './log-format.js'
import type { McDisApp } from './mcdis-app.js'
import { ProcessPluginManager } from './process-plugin-manager.js'
import type { RegisteredPluginSource } from './process-plugin-manager.js'
import type { PluginContext } from './plugin.js'
import type { ThreadManager } from './thread-manager.js'
import type { ProcessState } from './types.js'

const RELAY_BATCH_SIZE = 10
const RELAY_IDLE_MS = 500

export class MinecraftProcess extends EventEmitter {
	private child: ChildProcessWithoutNullStreams | undefined
	private state: ProcessState = 'stopped'
	private relayBuffer: string[] = []
	private flushTimer: NodeJS.Timeout | undefined
	private thread: ThreadChannel | undefined
	private readonly pluginManager: ProcessPluginManager

	constructor(
		public readonly config: ProcessConfig,
		public readonly app: McDisApp,
		private readonly threadManager: ThreadManager,
		private readonly queue: DiscordMessageQueue,
	) {
		super()
		this.setMaxListeners(0)
		this.pluginManager = new ProcessPluginManager(this, this.absolutePluginsDirectory)
	}

	get name(): string {
		return this.config.name
	}

	get isRunning(): boolean {
		return this.child !== undefined && this.state !== 'stopped'
	}

	get cwd(): string {
		return this.absoluteCwd
	}

	get currentState(): ProcessState {
		return this.state
	}

	override emit(eventName: string | symbol, ...args: unknown[]): boolean {
		const emitted = super.emit(eventName, ...args)
		this.app.emit(eventName, ...args)
		this.app.emit('process:event', eventName, ...args)
		return emitted
	}

	getStatusLine(): string {
		const pid = this.child?.pid ? ` pid=${this.child.pid}` : ''
		return `${this.name}: ${this.state}${pid}`
	}

	createPluginContext(): PluginContext {
		return {
			name: this.name,
			cwd: this.cwd,
			prefix: this.config.prefix,
			app: this.app,
			process: this,
			getStatus: () => this.getStatusLine(),
			execute: (command) => {
				this.execute(command)
			},
			sendLog: (message) => {
				this.sendManagerLog(message)
			},
		}
	}

	async prepare(): Promise<void> {
		await mkdir(this.absoluteCwd, { recursive: true })
		await mkdir(this.absolutePluginsDirectory, { recursive: true })
		this.thread = await this.threadManager.getOrCreateConsoleThread(this.name)
		this.emit('process:prepare', this)
	}

	async start(): Promise<void> {
		if (this.isRunning) {
			this.sendManagerLog('Process is already running.')
			return
		}

		await this.prepare()
		this.state = 'starting'
		this.sendManagerLog('Loading process plugins...')
		await this.pluginManager.load()
		this.sendManagerLog('Initializing process...')
		this.emit('process:starting', this)

		const spawnArgs = this.getSpawnArgs()
		this.child = spawn(spawnArgs.command, spawnArgs.args, {
			cwd: this.absoluteCwd,
			shell: spawnArgs.shell,
			windowsHide: true,
		})

		this.state = 'running'
		this.emit('process:started', this.child, this)
		await this.pluginManager.notifyStart()
		this.attachOutput(this.child.stdout)
		this.attachOutput(this.child.stderr)

		this.child.once('exit', (code, signal) => {
			void this.finalizeStop(code, signal)
		})
	}

	stop(): void {
		if (!this.child) {
			this.sendManagerLog('Process is not running.')
			return
		}

		this.state = 'stopping'
		this.emit('process:stopping', this.config.stopCommand, this)
		this.execute(this.config.stopCommand)
	}

	async restart(): Promise<void> {
		if (!this.child) {
			await this.start()
			return
		}

		this.stop()
		await this.waitUntilStopped(60_000)
		if (this.child) {
			this.kill()
			await this.waitUntilStopped(5_000)
		}
		await this.start()
	}

	kill(): void {
		if (!this.child) {
			this.sendManagerLog('Process is not running.')
			return
		}

		this.state = 'stopping'
		this.emit('process:killing', this)
		this.child.kill('SIGKILL')
	}

	execute(command: string): void {
		if (!this.child) {
			this.sendManagerLog(`Cannot execute while process is stopped: ${command}`)
			return
		}

		this.emit('process:command', command, this)
		this.child.stdin.write(`${command}\n`)
	}

	async handleThreadCommand(messageOrCommand: Message | string): Promise<void> {
		const rawCommand =
			typeof messageOrCommand === 'string' ? messageOrCommand : messageOrCommand.content
		const trimmedCommand = rawCommand.trim()
		const commandWithoutPrefix = trimmedCommand.startsWith(this.config.prefix)
			? trimmedCommand.slice(this.config.prefix.length).trim()
			: trimmedCommand
		const normalized = commandWithoutPrefix.toLowerCase()
		this.emit('discord:command', commandWithoutPrefix, messageOrCommand, this)

		if (normalized === 'plugins-reload' || normalized === 'mdreload') {
			await this.reloadPlugins()
		} else if (
			typeof messageOrCommand !== 'string' &&
			(await this.pluginManager.notifyDiscordMessage(messageOrCommand, commandWithoutPrefix))
		) {
			return
		} else if (normalized === 'start') {
			await this.start()
		} else if (normalized === 'stop') {
			this.stop()
		} else if (normalized === 'restart') {
			await this.restart()
		} else if (normalized === 'kill') {
			this.kill()
		} else if (normalized === 'status') {
			this.sendManagerLog(this.getStatusLine())
		} else if (commandWithoutPrefix.length > 0) {
			this.execute(commandWithoutPrefix)
		}
	}

	async reloadPlugins(): Promise<void> {
		await this.prepare()
		this.sendManagerLog('Reloading process plugins...')
		await this.pluginManager.load({ reload: true })
	}

	async registerPluginSource(source: RegisteredPluginSource): Promise<() => Promise<void>> {
		const unregister = this.pluginManager.registerSource(source)
		this.emit('plugin:registered', source, this)

		if (this.pluginManager.isLoaded) {
			await this.reloadPlugins()
		}

		return async () => {
			unregister()
			this.emit('plugin:unregistered', source, this)

			if (this.pluginManager.isLoaded) {
				await this.reloadPlugins()
			}
		}
	}

	private get absoluteCwd(): string {
		return path.resolve(this.config.cwd)
	}

	private get absolutePluginsDirectory(): string {
		return path.resolve(this.absoluteCwd, this.config.plugins.directory)
	}

	private getSpawnArgs(): { command: string; args: string[]; shell: boolean } {
		if (Array.isArray(this.config.startCommand)) {
			const [command, ...args] = this.config.startCommand
			if (!command) {
				throw new Error(`${this.name}: startCommand array must include a command`)
			}

			return { command, args, shell: false }
		}

		return { command: this.config.startCommand, args: [], shell: true }
	}

	private attachOutput(stream: NodeJS.ReadableStream): void {
		const reader = readline.createInterface({ input: stream })
		reader.on('line', (line) => {
			const cleanLine = cleanConsoleLog(line)
			this.emit('console:line', cleanLine, this)
			void this.pluginManager.notifyConsoleLine(cleanLine)
			if (shouldRelayLog(cleanLine, this.config.blacklist)) {
				this.addRelayLog(cleanLine)
			}
		})
	}

	sendManagerLog(message: string): void {
		this.addRelayLog(formatManagerLog(message))
	}

	private async finalizeStop(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
		this.sendManagerLog(`Process stopped. code=${code ?? 'null'} signal=${signal ?? 'null'}`)
		this.emit('process:stopped', { code, signal }, this)
		await this.pluginManager.notifyStop()
		await this.pluginManager.unload()
		this.state = 'stopped'
		this.child = undefined
		this.flushRelayBuffer()
	}

	private addRelayLog(log: string): void {
		this.relayBuffer.push(log)

		if (this.relayBuffer.length >= RELAY_BATCH_SIZE) {
			this.flushRelayBuffer()
			return
		}

		if (!this.flushTimer) {
			this.flushTimer = setTimeout(() => {
				this.flushRelayBuffer()
			}, RELAY_IDLE_MS)
		}
	}

	private flushRelayBuffer(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer)
			this.flushTimer = undefined
		}

		if (!this.thread || this.relayBuffer.length === 0) {
			return
		}

		const payload = this.relayBuffer.splice(0, this.relayBuffer.length).join('\n')
		this.queue.enqueueCodeBlock(this.thread, payload)
	}

	private async waitUntilStopped(timeoutMs: number): Promise<void> {
		const startedAt = Date.now()
		while (this.child && Date.now() - startedAt < timeoutMs) {
			await sleep(100)
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}
