import { setTimeout } from 'node:timers/promises'
type QueueItem = {
	channel: DiscordSendTarget
	content: string
}

type DiscordSendTarget = {
	send(options: { content: string }): Promise<unknown>
}

export type DiscordMessageQueueOptions = {
	minIntervalMs: number
	maxQueuedMessages: number
	codeBlockLanguage: string
}

const DISCORD_MESSAGE_LIMIT = 2000

export class DiscordMessageQueue {
	private readonly queue: QueueItem[] = []
	private running = false

	constructor(private readonly options: DiscordMessageQueueOptions) {}

	enqueueCodeBlock(channel: DiscordSendTarget, content: string): void {
		const chunks = splitForCodeBlock(content, this.options.codeBlockLanguage)

		for (const chunk of chunks) {
			if (this.queue.length >= this.options.maxQueuedMessages) {
				this.queue.shift()
			}

			this.queue.push({ channel, content: chunk })
		}

		void this.run()
	}

	enqueueRaw(channel: DiscordSendTarget, content: string): void {
		if (this.queue.length >= this.options.maxQueuedMessages) {
			this.queue.shift()
		}

		this.queue.push({ channel, content })
		void this.run()
	}

	private async run(): Promise<void> {
		if (this.running) {
			return
		}

		this.running = true
		try {
			while (this.queue.length > 0) {
				const item = this.queue.shift()
				if (!item) {
					continue
				}

				await item.channel.send({ content: item.content })
				await setTimeout(this.options.minIntervalMs)
			}
		} finally {
			this.running = false
		}
	}
}

function splitForCodeBlock(content: string, language: string): string[] {
	const opening = `\`\`\`${language}\n`
	const closing = '\n```'
	const maxBodyLength = DISCORD_MESSAGE_LIMIT - opening.length - closing.length
	const normalized = content.length > 0 ? content : ' '
	const chunks: string[] = []

	let current = ''
	for (const line of normalized.split('\n')) {
		const pending = current.length === 0 ? line : `${current}\n${line}`
		if (pending.length <= maxBodyLength) {
			current = pending
			continue
		}

		if (current.length > 0) {
			chunks.push(`${opening}${current}${closing}`)
			current = ''
		}

		if (line.length <= maxBodyLength) {
			current = line
			continue
		}

		for (let index = 0; index < line.length; index += maxBodyLength) {
			chunks.push(`${opening}${line.slice(index, index + maxBodyLength)}${closing}`)
		}
	}

	if (current.length > 0) {
		chunks.push(`${opening}${current}${closing}`)
	}

	return chunks
}
