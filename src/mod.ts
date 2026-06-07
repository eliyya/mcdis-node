import type { Message } from 'discord.js'
import type { McDisApp } from './mcdis-app.js'

type CleanupCallback = () => void | Promise<void>

export type ModContext = {
	app: McDisApp
	prefix: string
	sendLog: (message: string) => void
}

export abstract class Mod {
	name = this.constructor.name
	private readonly cleanupCallbacks: CleanupCallback[] = []

	constructor(protected readonly context: ModContext) {}

	protected get app(): McDisApp {
		return this.context.app
	}

	protected listen(eventName: string | symbol, listener: (...args: unknown[]) => void): void {
		this.app.on(eventName, listener)
		this.addCleanup(() => {
			this.app.off(eventName, listener)
		})
	}

	protected once(eventName: string | symbol, listener: (...args: unknown[]) => void): void {
		this.app.once(eventName, listener)
	}

	protected addCleanup(cleanup: CleanupCallback): void {
		this.cleanupCallbacks.push(cleanup)
	}

	async cleanup(): Promise<void> {
		while (this.cleanupCallbacks.length > 0) {
			await this.cleanupCallbacks.pop()?.()
		}
	}

	async onLoad(): Promise<void> {}

	async onUnload(): Promise<void> {}

	async onReady(): Promise<void> {}

	async onShutdown(): Promise<void> {}

	async onDiscordMessage(_message: Message): Promise<boolean | void> {}
}

export type ModLoadFunction = (context: ModContext) => Promise<Mod>
