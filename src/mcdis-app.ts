import { EventEmitter } from 'node:events'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { ChannelType, Client, GatewayIntentBits, Partials, type Message } from 'discord.js'
import { ModManager } from './mod-manager.js'
import type { AppConfig } from './config.js'
import { DiscordMessageQueue } from './discord-message-queue.js'
import { MinecraftProcess } from './minecraft-process.js'
import { Plugin, type PluginContext } from './plugin.js'
import type { RegisteredPluginSource } from './process-plugin-manager.js'
import { ThreadManager } from './thread-manager.js'

export type ProcessPluginRegistrationOptions = {
	processName: string
	file?: string
	plugin?: Plugin | ((context: PluginContext) => Plugin | Promise<Plugin>)
	name?: string
}

export type MultiProcessPluginRegistrationOptions = {
	processNames?: string[]
	file?: string
	plugin?: (context: PluginContext) => Plugin | Promise<Plugin>
	name?: string
}

export class McDisApp extends EventEmitter {
	readonly client = new Client<true>({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
		],
		partials: [Partials.Channel],
	})

	readonly queue: DiscordMessageQueue
	readonly threadManager: ThreadManager
	private readonly modManager: ModManager
	private readonly processes = new Map<string, MinecraftProcess>()
	private readonly helpers = new Map<string, unknown>()

	constructor(readonly config: AppConfig) {
		super()
		this.setMaxListeners(0)
		this.queue = new DiscordMessageQueue(config.discord.queue)
		this.threadManager = new ThreadManager(this.client, config.discord.panelChannelId)
		this.modManager = new ModManager(this, path.resolve(config.mods.directory))

		for (const processConfig of Object.values(config.processes)) {
			const process = new MinecraftProcess(
				processConfig,
				this,
				this.threadManager,
				this.queue,
			)
			this.processes.set(process.name.toLowerCase(), process)
			this.emit('process:registered', process, this)
		}
	}

	getProcess(name: string): MinecraftProcess | undefined {
		return this.processes.get(name.toLowerCase())
	}

	getProcesses(): MinecraftProcess[] {
		return [...this.processes.values()]
	}

	async registerProcessPlugin(
		options: ProcessPluginRegistrationOptions,
	): Promise<() => Promise<void>> {
		const process = this.getProcess(options.processName)
		if (!process) {
			throw new Error(`Unknown process: ${options.processName}`)
		}

		const source = this.createPluginSource(options)
		return process.registerPluginSource(source)
	}

	async registerProcessPluginForMany(
		options: MultiProcessPluginRegistrationOptions,
	): Promise<() => Promise<void>> {
		const targetProcesses = options.processNames
			? options.processNames.map((processName) => {
					const process = this.getProcess(processName)
					if (!process) {
						throw new Error(`Unknown process: ${processName}`)
					}

					return process
				})
			: this.getProcesses()

		const unregisterCallbacks: Array<() => Promise<void>> = []
		for (const process of targetProcesses) {
			unregisterCallbacks.push(
				await process.registerPluginSource(this.createPluginSource(options)),
			)
		}

		return async () => {
			for (const unregister of unregisterCallbacks.reverse()) {
				await unregister()
			}
		}
	}

	async run(token: string): Promise<void> {
		this.client.once('ready', () => {
			void this.onReady()
		})

		this.client.on('messageCreate', (message) => {
			void this.onMessage(message)
		})

		process.once('SIGINT', () => {
			void this.shutdown()
		})

		process.once('SIGTERM', () => {
			void this.shutdown()
		})

		await this.client.login(token)
	}

	async sendManagerLog(message: string): Promise<void> {
		console.log(message)

		if (!this.client.isReady()) {
			return
		}

		const panel = await this.threadManager.getPanelChannel().catch(() => undefined)
		if (panel) {
			this.queue.enqueueCodeBlock(panel, message)
		}
	}

	registerHelper<T>(name: string, helper: T): () => void {
		if (this.helpers.has(name)) {
			throw new Error(`Helper already registered: ${name}`)
		}

		this.helpers.set(name, helper)
		this.emit('helper:registered', name, helper, this)

		return () => {
			if (this.helpers.get(name) === helper) {
				this.helpers.delete(name)
				this.emit('helper:unregistered', name, helper, this)
			}
		}
	}

	getHelper<T = unknown>(name: string): T | undefined {
		return this.helpers.get(name) as T | undefined
	}

	hasHelper(name: string): boolean {
		return this.helpers.has(name)
	}

	async reloadMods(): Promise<void> {
		await mkdir(path.resolve(this.config.mods.directory), { recursive: true })
		await this.sendManagerLog('Reloading mods...')
		await this.modManager.load({ reload: true })
	}

	private createPluginSource(
		options: Omit<ProcessPluginRegistrationOptions, 'processName'>,
	): RegisteredPluginSource {
		if (options.file) {
			const absoluteFile = path.resolve(options.file)

			return {
				file: absoluteFile,
				name: options.name ?? path.basename(options.file),
			}
		}

		if (options.plugin instanceof Plugin) {
			return {
				name: options.name ?? options.plugin.name,
				load: () => options.plugin as Plugin,
			}
		}

		if (typeof options.plugin === 'function') {
			return {
				name: options.name ?? 'injected-plugin',
				load: options.plugin,
			}
		}

		throw new Error('Plugin registration requires either file or plugin.')
	}

	private async onReady(): Promise<void> {
		console.log(`Logged in as ${this.client.user?.tag ?? 'unknown bot'}`)
		await this.threadManager.getPanelChannel()
		await mkdir(path.resolve(this.config.mods.directory), { recursive: true })
		await this.modManager.load()
		for (const process of this.processes.values()) {
			this.emit('process:registered', process, this)
		}
		this.emit('app:ready', this)
		await this.modManager.notifyReady()

		for (const process of this.processes.values()) {
			await process.prepare()
			if (process.config.autoStart) {
				await process.start()
			}
		}

		console.log(`Loaded ${this.processes.size} managed process(es).`)
	}

	private async onMessage(message: Message): Promise<void> {
		if (message.author.bot) {
			return
		}

		if (await this.modManager.notifyDiscordMessage(message)) {
			return
		}

		if (message.channel.type === ChannelType.PublicThread) {
			await this.handleThreadMessage(message)
			return
		}

		if (message.channelId === this.config.discord.panelChannelId) {
			await this.handlePanelCommand(message)
		}
	}

	private async handleThreadMessage(message: Message): Promise<void> {
		const channel = message.channel
		if (
			channel.type !== ChannelType.PublicThread ||
			channel.parentId !== this.config.discord.panelChannelId
		) {
			return
		}

		const processName = channel.name.replace(/^Console /u, '').toLowerCase()
		const process = this.processes.get(processName)
		if (!process) {
			return
		}

		await process.handleThreadCommand(message)
	}

	private async handlePanelCommand(message: Message): Promise<void> {
		const prefix = this.config.discord.prefix
		if (!message.content.startsWith(prefix)) {
			return
		}

		const [commandWithPrefix, ...args] = message.content.trim().split(/\s+/u)
		const command = commandWithPrefix?.slice(prefix.length).toLowerCase()
		const targetName = args.join(' ').toLowerCase()

		if (!command) {
			return
		}

		if (command === 'mods-reload') {
			await this.reloadMods()
			await message.reply('Reloaded mods.')
			return
		}

		if (command.endsWith('-all')) {
			const baseCommand = command.replace(/-all$/u, '')
			await this.runForAll(baseCommand)
			await message.reply(`Executed ${baseCommand} for all processes.`)
			return
		}

		if (command === 'status' && targetName.length === 0) {
			await message.reply(
				[...this.processes.values()].map((item) => item.getStatusLine()).join('\n') ||
					'No processes configured.',
			)
			return
		}

		const process = this.processes.get(targetName)
		if (!process) {
			await message.reply(`Unknown process: ${targetName || '(missing)'}`)
			return
		}

		await this.runProcessCommand(process, command)
		await message.reply(`Executed ${command} for ${process.name}.`)
	}

	private async runForAll(command: string): Promise<void> {
		for (const process of this.processes.values()) {
			await this.runProcessCommand(process, command)
		}
	}

	private async runProcessCommand(process: MinecraftProcess, command: string): Promise<void> {
		if (command === 'start') {
			await process.start()
		} else if (command === 'stop') {
			process.stop()
		} else if (command === 'restart') {
			await process.restart()
		} else if (command === 'kill') {
			process.kill()
		} else if (command === 'plugins-reload' || command === 'mdreload') {
			await process.reloadPlugins()
		} else if (command === 'status') {
			const panel = await this.threadManager.getPanelChannel()
			this.queue.enqueueCodeBlock(panel, process.getStatusLine())
		}
	}

	private async shutdown(): Promise<void> {
		console.log('Shutting down managed processes...')
		this.emit('app:shutdown', this)
		await this.modManager.notifyShutdown()
		await this.modManager.unload()

		for (const process of this.processes.values()) {
			process.stop()
		}

		const exitTimer = setTimeout(() => {
			for (const process of this.processes.values()) {
				if (process.isRunning) {
					process.kill()
				}
			}
			void this.client.destroy()
			process.exit(0)
		}, 10_000)
		exitTimer.unref()
	}
}
