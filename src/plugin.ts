import type { Message } from 'discord.js'
import type { McDisApp } from './mcdis-app.js'
import type { MinecraftProcess } from './minecraft-process.js'

export type { MinecraftProcess } from './minecraft-process.js'

export type PluginContext = {
	name: string
	cwd: string
	prefix: string
	app: McDisApp
	process: MinecraftProcess
	getStatus: () => string
	execute: (command: string) => void
	sendLog: (message: string) => void
}

export abstract class Plugin {
	name = this.constructor.name
	private readonly cleanupListeners: Array<() => void> = []

	constructor(protected readonly context: PluginContext) {}

	protected get process(): MinecraftProcess {
		return this.context.process
	}

	protected get app(): McDisApp {
		return this.context.app
	}

	protected listen(eventName: string | symbol, listener: (...args: unknown[]) => void): void {
		this.process.on(eventName, listener)
		this.cleanupListeners.push(() => {
			this.process.off(eventName, listener)
		})
	}

	protected once(eventName: string | symbol, listener: (...args: unknown[]) => void): void {
		this.process.once(eventName, listener)
	}

	async cleanup(): Promise<void> {
		while (this.cleanupListeners.length > 0) {
			this.cleanupListeners.pop()?.()
		}
	}

	async onLoad(): Promise<void> {}

	async onUnload(): Promise<void> {}

	async onStart(): Promise<void> {}

	async onStop(): Promise<void> {}

	async onConsoleLine(_line: string): Promise<void> {}

	async onDiscordMessage(_message: Message, _command: string): Promise<boolean | void> {}
}

export type PluginLoadFunction = (context: PluginContext) => Promise<Plugin>
