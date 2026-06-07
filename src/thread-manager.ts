import { ChannelType, type Client, type TextChannel, type ThreadChannel } from 'discord.js'

export class ThreadManager {
	constructor(
		private readonly client: Client,
		private readonly panelChannelId: string,
	) {}

	async getPanelChannel(): Promise<TextChannel> {
		const channel = await this.client.channels.fetch(this.panelChannelId)
		if (!channel || channel.type !== ChannelType.GuildText) {
			throw new Error(`Panel channel ${this.panelChannelId} is not a guild text channel`)
		}

		return channel
	}

	async getOrCreateConsoleThread(name: string): Promise<ThreadChannel> {
		const panel = await this.getPanelChannel()
		const threadName = `Console ${name}`

		const activeThreads = await panel.threads.fetchActive()
		const activeThread = activeThreads.threads.find((thread) => thread.name === threadName)
		if (activeThread) {
			return activeThread
		}

		const publicArchived = await panel.threads.fetchArchived({ type: 'public' })
		const archivedThread = publicArchived.threads.find((thread) => thread.name === threadName)
		if (archivedThread) {
			await archivedThread.setArchived(false)
			return archivedThread
		}

		const anchor = await panel.send('_')
		const thread = await anchor.startThread({
			name: threadName,
			autoArchiveDuration: 1440,
		})
		await anchor.delete().catch(() => undefined)

		return thread
	}
}
