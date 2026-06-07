#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { loadConfig } from './config.js'
import { McDisApp } from './mcdis-app.js'

try {
	process.loadEnvFile('.env')
} catch (error) {
	if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
		throw error
	}
}

const { values } = parseArgs({
	options: {
		config: {
			type: 'string',
			short: 'c',
			default: 'config.json',
		},
	},
})

const configPath = values.config
const config = await loadConfig(configPath)
const token = process.env[config.discord.tokenEnv]

if (!token) {
	throw new Error(
		`Missing Discord token. Set ${config.discord.tokenEnv} in the environment or .env file.`,
	)
}

const app = new McDisApp(config)
await app.run(token)
