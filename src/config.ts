import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

const processNameSchema = z
	.string()
	.min(1)
	.max(40)
	.regex(/^[\w .-]+$/u)

const queueSchema = z
	.object({
		minIntervalMs: z.number().int().positive().default(1200),
		maxQueuedMessages: z.number().int().positive().default(1000),
		codeBlockLanguage: z.string().default('md'),
	})
	.default({
		minIntervalMs: 1200,
		maxQueuedMessages: 1000,
		codeBlockLanguage: 'md',
	})

const processSettingsSchema = z.object({
	type: z.enum(['server', 'network']).default('server'),
	cwd: z.string().min(1).optional(),
	startCommand: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
	stopCommand: z.string().min(1).default('stop'),
	autoStart: z.boolean().default(false),
	blacklist: z.array(z.string()).default([]),
	plugins: z
		.object({
			enabled: z.boolean().default(true),
			directory: z.string().min(1).default('.mdplugins'),
		})
		.default({
			enabled: true,
			directory: '.mdplugins',
		}),
})

const discordSchema = z.object({
	tokenEnv: z.string().min(1).default('DISCORD_TOKEN'),
	panelChannelId: z.string().regex(/^\d+$/u),
	prefix: z.string().min(1).default('!!'),
	queue: queueSchema,
})

const modsSchema = z
	.object({
		enabled: z.boolean().default(true),
		directory: z.string().min(1).default('.mdmods'),
	})
	.default({
		enabled: true,
		directory: '.mdmods',
	})

const configFileSchema = z.object({
	$schema: z.string().optional(),
	discord: discordSchema,
	mods: modsSchema,
	processes: z.record(z.string(), processSettingsSchema).default({}),
})

export type ProcessConfig = z.infer<typeof processSettingsSchema> & {
	name: string
	prefix: string
	cwd: string
}

export type AppConfig = {
	discord: z.infer<typeof discordSchema>
	mods: z.infer<typeof modsSchema>
	processes: Record<string, ProcessConfig>
}

export async function loadConfig(configPath: string): Promise<AppConfig> {
	const absolutePath = path.resolve(configPath)
	const rawConfig = await readFile(absolutePath, 'utf8')
	const parsedConfig = JSON.parse(rawConfig) as unknown
	const fileConfig = configFileSchema.parse(parsedConfig)

	const names = new Set<string>()
	const processes: Record<string, ProcessConfig> = {}

	for (const [name, processConfig] of Object.entries(fileConfig.processes)) {
		processNameSchema.parse(name)
		const normalizedName = name.toLowerCase()
		if (names.has(normalizedName)) {
			throw new Error(`Duplicate process name: ${name}`)
		}
		names.add(normalizedName)
		processes[name] = {
			name,
			prefix: fileConfig.discord.prefix,
			...processConfig,
			cwd: processConfig.cwd ?? name,
		}
	}

	return {
		discord: fileConfig.discord,
		mods: fileConfig.mods,
		processes,
	}
}
