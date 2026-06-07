import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Message } from 'discord.js'
import { Mod, type ModContext, type ModLoadFunction } from './mod.js'
import type { McDisApp } from './mcdis-app.js'

type LoadedMod = {
	file: string
	mod: Mod
}

type ModEntrypoint = {
	file: string
	name: string
}

type ModPackageJson = {
	main?: unknown
}

const modExtensions = new Set(['.cjs', '.js', '.mjs', '.ts'])
const directoryEntrypointNames = ['mod', 'index']

export class ModManager {
	private readonly loadedMods: LoadedMod[] = []

	constructor(
		private readonly app: McDisApp,
		private readonly modsDirectory: string,
	) {}

	async load({ reload = false }: { reload?: boolean } = {}): Promise<void> {
		if (!this.app.config.mods.enabled) {
			return
		}

		if (reload || this.loadedMods.length > 0) {
			await this.unload()
		}

		const entrypoints = await this.getModEntrypoints()
		if (entrypoints.length === 0) {
			await this.app.sendManagerLog('No mods to import.')
			return
		}

		for (const entrypoint of entrypoints) {
			try {
				const mod = await this.importMod(entrypoint.file)
				this.loadedMods.push({ file: entrypoint.file, mod })
				await mod.onLoad()
				this.app.emit('mod:loaded', mod, entrypoint.file, this.app)
				await this.app.sendManagerLog(`Mod imported: ${mod.name || entrypoint.name}`)
			} catch (error) {
				await this.app.sendManagerLog(
					`Unable to import mod ${entrypoint.name}: ${formatError(error)}`,
				)
			}
		}
	}

	async unload(): Promise<void> {
		while (this.loadedMods.length > 0) {
			const loadedMod = this.loadedMods.pop()
			if (!loadedMod) {
				continue
			}

			let unloadError: unknown
			try {
				await loadedMod.mod.onUnload()
			} catch (error) {
				unloadError = error
			} finally {
				await loadedMod.mod.cleanup()
				this.app.emit('mod:unloaded', loadedMod.mod, loadedMod.file, this.app)
			}

			if (unloadError) {
				await this.app.sendManagerLog(
					`Mod unload failed ${path.basename(loadedMod.file)}: ${formatError(unloadError)}`,
				)
			}
		}
	}

	async notifyReady(): Promise<void> {
		await this.callHook('onReady')
	}

	async notifyShutdown(): Promise<void> {
		await this.callHook('onShutdown')
	}

	async notifyDiscordMessage(message: Message): Promise<boolean> {
		let handled = false

		for (const { mod, file } of this.loadedMods) {
			try {
				handled = (await mod.onDiscordMessage(message)) === true || handled
			} catch (error) {
				await this.app.sendManagerLog(
					`Mod Discord hook failed ${path.basename(file)}: ${formatError(error)}`,
				)
			}
		}

		return handled
	}

	private get context(): ModContext {
		return {
			app: this.app,
			prefix: this.app.config.discord.prefix,
			sendLog: (message) => {
				void this.app.sendManagerLog(message)
			},
		}
	}

	private async callHook(hookName: 'onReady' | 'onShutdown'): Promise<void> {
		for (const { mod, file } of this.loadedMods) {
			try {
				await mod[hookName]()
			} catch (error) {
				await this.app.sendManagerLog(
					`Mod ${hookName} failed ${path.basename(file)}: ${formatError(error)}`,
				)
			}
		}
	}

	private async getModEntrypoints(): Promise<ModEntrypoint[]> {
		let entries: string[]
		try {
			entries = await readdir(this.modsDirectory)
		} catch {
			return []
		}

		const entrypoints: ModEntrypoint[] = []
		for (const entry of entries) {
			const file = path.join(this.modsDirectory, entry)
			const fileStat = await stat(file).catch(() => undefined)
			if (fileStat?.isFile() && modExtensions.has(path.extname(entry))) {
				entrypoints.push({ file, name: entry })
			} else if (fileStat?.isDirectory()) {
				const directoryEntrypoint = await this.resolveDirectoryEntrypoint(file).catch(
					(error) => {
						void this.app.sendManagerLog(
							`Unable to resolve mod directory ${entry}: ${formatError(error)}`,
						)
						return undefined
					},
				)
				if (directoryEntrypoint) {
					entrypoints.push({ file: directoryEntrypoint, name: entry })
				}
			}
		}

		return entrypoints.sort((left, right) => left.name.localeCompare(right.name))
	}

	private async resolveDirectoryEntrypoint(directory: string): Promise<string | undefined> {
		const packageEntrypoint = await this.resolvePackageEntrypoint(directory)
		if (packageEntrypoint) {
			return packageEntrypoint
		}

		for (const entrypointName of directoryEntrypointNames) {
			for (const extension of modExtensions) {
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
		const packageJson = await readModPackageJson(packageJsonPath)
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
				`${path.basename(directory)} package.json entrypoint must stay inside the mod directory.`,
			)
		}

		const candidateStat = await stat(candidate).catch(() => undefined)
		if (!candidateStat?.isFile() || !modExtensions.has(path.extname(candidate))) {
			throw new Error(
				`${path.basename(directory)} package.json entrypoint must be a .js, .mjs, .cjs or .ts file.`,
			)
		}

		return candidate
	}

	private async importMod(file: string): Promise<Mod> {
		const fileStat = await stat(file)
		const modUrl = `${pathToFileURL(file).href}?updated=${fileStat.mtimeMs}`
		const module = (await import(modUrl)) as { load?: ModLoadFunction }
		const load = module.load

		if (typeof load !== 'function') {
			throw new Error('Mod must export an async load(context) function.')
		}

		const mod = await load(this.context)
		if (!(mod instanceof Mod)) {
			throw new Error('Mod load(context) must return an instance that extends Mod.')
		}

		return mod
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

async function readModPackageJson(packageJsonPath: string): Promise<ModPackageJson | undefined> {
	const rawPackageJson = await readFile(packageJsonPath, 'utf8').catch(() => undefined)
	if (!rawPackageJson) {
		return undefined
	}

	return JSON.parse(rawPackageJson) as ModPackageJson
}
