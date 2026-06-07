import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Message } from 'discord.js'
import type { MinecraftProcess } from './minecraft-process.js'
import { Plugin, type PluginContext, type PluginLoadFunction } from './plugin.js'

type LoadedPlugin = {
	file: string
	plugin: Plugin
}

type PluginEntrypoint = {
	file: string
	name: string
}

export type RegisteredPluginEntrypoint = PluginEntrypoint
export type RegisteredPluginFactory = {
	name: string
	load: (context: PluginContext) => Plugin | Promise<Plugin>
}
export type RegisteredPluginSource = RegisteredPluginEntrypoint | RegisteredPluginFactory

type PluginPackageJson = {
	main?: unknown
}

const pluginExtensions = new Set(['.cjs', '.js', '.mjs', '.ts'])
const directoryEntrypointNames = ['plugin', 'index']

export class ProcessPluginManager {
	private readonly loadedPlugins: LoadedPlugin[] = []
	private readonly registeredSources = new Map<symbol, RegisteredPluginSource>()

	constructor(
		private readonly process: MinecraftProcess,
		private readonly pluginsDirectory: string,
	) {}

	get isLoaded(): boolean {
		return this.loadedPlugins.length > 0
	}

	registerSource(source: RegisteredPluginSource): () => void {
		const registrationId = Symbol(source.name)
		this.registeredSources.set(registrationId, source)

		return () => {
			this.registeredSources.delete(registrationId)
		}
	}

	async load({ reload = false }: { reload?: boolean } = {}): Promise<void> {
		if (!this.process.config.plugins.enabled) {
			return
		}

		if (reload || this.loadedPlugins.length > 0) {
			await this.unload()
		}

		const sources = await this.getPluginSources()
		if (sources.length === 0) {
			this.process.sendManagerLog('No process plugins to import.')
			return
		}

		for (const source of sources) {
			try {
				const plugin = await this.loadPluginSource(source)
				const pluginSource = isPluginEntrypoint(source) ? source.file : source.name
				this.loadedPlugins.push({ file: pluginSource, plugin })
				await plugin.onLoad()
				this.process.emit('plugin:loaded', plugin, pluginSource, this.process)
				this.process.sendManagerLog(`Plugin imported: ${plugin.name || source.name}`)
			} catch (error) {
				this.process.sendManagerLog(
					`Unable to import plugin ${source.name}: ${formatError(error)}`,
				)
			}
		}
	}

	async unload(): Promise<void> {
		while (this.loadedPlugins.length > 0) {
			const loadedPlugin = this.loadedPlugins.pop()
			if (!loadedPlugin) {
				continue
			}

			let unloadError: unknown
			try {
				await loadedPlugin.plugin.onUnload()
			} catch (error) {
				unloadError = error
			} finally {
				await loadedPlugin.plugin.cleanup()
				this.process.emit(
					'plugin:unloaded',
					loadedPlugin.plugin,
					loadedPlugin.file,
					this.process,
				)
			}

			if (unloadError) {
				this.process.sendManagerLog(
					`Plugin unload failed ${path.basename(loadedPlugin.file)}: ${formatError(unloadError)}`,
				)
			}
		}
	}

	async notifyStart(): Promise<void> {
		await this.callHook('onStart')
	}

	async notifyStop(): Promise<void> {
		await this.callHook('onStop')
	}

	async notifyConsoleLine(line: string): Promise<void> {
		for (const { plugin, file } of this.loadedPlugins) {
			try {
				await plugin.onConsoleLine(line)
			} catch (error) {
				this.process.sendManagerLog(
					`Plugin console hook failed ${path.basename(file)}: ${formatError(error)}`,
				)
			}
		}
	}

	async notifyDiscordMessage(message: Message, command: string): Promise<boolean> {
		let handled = false

		for (const { plugin, file } of this.loadedPlugins) {
			try {
				handled = (await plugin.onDiscordMessage(message, command)) === true || handled
			} catch (error) {
				this.process.sendManagerLog(
					`Plugin Discord hook failed ${path.basename(file)}: ${formatError(error)}`,
				)
			}
		}

		return handled
	}

	private get context(): PluginContext {
		return this.process.createPluginContext()
	}

	private async callHook(hookName: 'onStart' | 'onStop'): Promise<void> {
		for (const { plugin, file } of this.loadedPlugins) {
			try {
				await plugin[hookName]()
			} catch (error) {
				this.process.sendManagerLog(
					`Plugin ${hookName} failed ${path.basename(file)}: ${formatError(error)}`,
				)
			}
		}
	}

	private async getPluginSources(): Promise<RegisteredPluginSource[]> {
		let entries: string[]
		try {
			entries = await readdir(this.pluginsDirectory)
		} catch {
			return []
		}

		const entrypoints: PluginEntrypoint[] = []
		for (const entry of entries) {
			const file = path.join(this.pluginsDirectory, entry)
			const fileStat = await stat(file).catch(() => undefined)
			if (fileStat?.isFile() && pluginExtensions.has(path.extname(entry))) {
				entrypoints.push({ file, name: entry })
			} else if (fileStat?.isDirectory()) {
				const directoryEntrypoint = await this.resolveDirectoryEntrypoint(file).catch(
					(error) => {
						this.process.sendManagerLog(
							`Unable to resolve plugin directory ${entry}: ${formatError(error)}`,
						)
						return undefined
					},
				)
				if (directoryEntrypoint) {
					entrypoints.push({ file: directoryEntrypoint, name: entry })
				}
			}
		}

		return [...entrypoints, ...this.registeredSources.values()].sort((left, right) =>
			left.name.localeCompare(right.name),
		)
	}

	private async resolveDirectoryEntrypoint(directory: string): Promise<string | undefined> {
		const packageEntrypoint = await this.resolvePackageEntrypoint(directory)
		if (packageEntrypoint) {
			return packageEntrypoint
		}

		for (const entrypointName of directoryEntrypointNames) {
			for (const extension of pluginExtensions) {
				const candidate = path.join(directory, `${entrypointName}${extension}`)
				const candidateStat = await stat(candidate).catch(() => undefined)
				if (candidateStat?.isFile()) {
					return candidate
				}
			}
		}

		return undefined
	}

	private async resolvePackageEntrypoint(directory: string): Promise<string | undefined> {
		const packageJsonPath = path.join(directory, 'package.json')
		const packageJson = await readPluginPackageJson(packageJsonPath)
		if (!packageJson) {
			return undefined
		}

		const declaredEntrypoint = packageJson.main

		if (typeof declaredEntrypoint !== 'string' || declaredEntrypoint.trim().length === 0) {
			return undefined
		}

		const candidate = path.resolve(directory, declaredEntrypoint)
		const relativeCandidate = path.relative(directory, candidate)
		if (relativeCandidate.startsWith('..') || path.isAbsolute(relativeCandidate)) {
			throw new Error(
				`${path.basename(directory)} package.json entrypoint must stay inside the plugin directory.`,
			)
		}

		const candidateStat = await stat(candidate).catch(() => undefined)
		if (!candidateStat?.isFile() || !pluginExtensions.has(path.extname(candidate))) {
			throw new Error(
				`${path.basename(directory)} package.json entrypoint must be a .js, .mjs, .cjs or .ts file.`,
			)
		}

		return candidate
	}

	private async importPlugin(file: string): Promise<Plugin> {
		const fileStat = await stat(file)
		const pluginUrl = `${pathToFileURL(file).href}?updated=${fileStat.mtimeMs}`
		const module = (await import(pluginUrl)) as { load?: PluginLoadFunction }
		const load = module.load

		if (typeof load !== 'function') {
			throw new Error('Plugin must export an async load(context) function.')
		}

		const plugin = await load(this.context)
		if (!(plugin instanceof Plugin)) {
			throw new Error('Plugin load(context) must return an instance that extends Plugin.')
		}

		return plugin
	}

	private async loadPluginSource(source: RegisteredPluginSource): Promise<Plugin> {
		if (isPluginEntrypoint(source)) {
			return this.importPlugin(source.file)
		}

		const plugin = await source.load(this.context)
		if (!(plugin instanceof Plugin)) {
			throw new Error(
				'Registered plugin factory must return an instance that extends Plugin.',
			)
		}

		return plugin
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

async function readPluginPackageJson(
	packageJsonPath: string,
): Promise<PluginPackageJson | undefined> {
	const rawPackageJson = await readFile(packageJsonPath, 'utf8').catch(() => undefined)
	if (!rawPackageJson) {
		return undefined
	}

	return JSON.parse(rawPackageJson) as PluginPackageJson
}

function isPluginEntrypoint(source: RegisteredPluginSource): source is RegisteredPluginEntrypoint {
	return 'file' in source
}
