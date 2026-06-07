# McDis Node API

Referencia de la API para `mods`, `plugins`, procesos, eventos y configuracion.

## Conceptos

- `McDisApp`: instancia global. Controla Discord, procesos, mods, helpers y eventos globales.
- `MinecraftProcess`: una instancia/proceso de Minecraft. Es un `EventEmitter`.
- `Plugin`: extension local de un proceso. Recibe `PluginContext` con acceso al proceso y a la app.
- `Mod`: extension global de McDis. Recibe `ModContext` con acceso a la app.
- `Helper`: utilidad compartida registrada en `McDisApp` para que mods y plugins puedan reutilizarla.

## Config

Archivo default:

```txt
config.json
```

CLI:

```sh
pnpm start -- --config config.json
pnpm start -- -c config.json
```

Forma minima:

```json
{
	"discord": {
		"tokenEnv": "DISCORD_TOKEN",
		"panelChannelId": "123456789012345678",
		"prefix": "!!"
	},
	"mods": {
		"enabled": true,
		"directory": ".mdmods"
	},
	"processes": {
		"smp": {
			"type": "server",
			"startCommand": "java -Xms1G -Xmx1G -jar paper.jar nogui",
			"stopCommand": "stop"
		}
	}
}
```

### `discord`

```ts
type DiscordConfig = {
	tokenEnv?: string // default: "DISCORD_TOKEN"
	panelChannelId: string
	prefix?: string // default: "!!"
	queue?: {
		minIntervalMs?: number // default: 1200
		maxQueuedMessages?: number // default: 1000
		codeBlockLanguage?: string // default: "md"
	}
}
```

### `mods`

```ts
type ModsConfig = {
	enabled?: boolean // default: true
	directory?: string // default: ".mdmods"
}
```

### `processes`

`processes` es un objeto. La clave es el nombre del proceso.

```ts
type ProcessConfig = {
	type?: 'server' | 'network' // default: "server"
	cwd?: string // default: nombre del proceso
	startCommand: string | string[]
	stopCommand?: string // default: "stop"
	autoStart?: boolean // default: false
	blacklist?: string[] // default: []
	plugins?: {
		enabled?: boolean // default: true
		directory?: string // default: ".mdplugins"
	}
}
```

Si `cwd` no existe en config, McDis usa el nombre del proceso:

```json
{
	"processes": {
		"smp": {
			"startCommand": "java -jar paper.jar nogui"
		}
	}
}
```

Equivale a:

```txt
cwd: "smp"
plugins: "smp/.mdplugins"
```

## Exports Publicos

```ts
import { Plugin, type PluginContext, type MinecraftProcess } from 'mcdis-node-recreation/plugin'
import { Mod, type ModContext } from 'mcdis-node-recreation/mod'
```

## McDisApp

`McDisApp` es un `EventEmitter`.

Propiedades publicas:

```ts
class McDisApp extends EventEmitter {
	readonly config: AppConfig
	readonly client: Client<true>
	readonly queue: DiscordMessageQueue
	readonly threadManager: ThreadManager
}
```

### Procesos

```ts
app.getProcess(name: string): MinecraftProcess | undefined
app.getProcesses(): MinecraftProcess[]
```

Ejemplo:

```ts
const smp = this.app.getProcess('smp')
smp?.execute('say hola')
```

### Registrar Plugins Desde Mods

Por archivo en un proceso:

```ts
const unregister = await app.registerProcessPlugin({
	processName: 'smp',
	file: '/abs/path/to/plugin.ts',
	name: 'my-plugin',
})

await unregister()
```

Por archivo en varios procesos:

```ts
const unregister = await app.registerProcessPluginForMany({
	processNames: ['smp', 'velocity'],
	file: '/abs/path/to/plugin.ts',
	name: 'shared-plugin',
})
```

Si `processNames` se omite, registra en todos los procesos:

```ts
const unregister = await app.registerProcessPluginForMany({
	file: '/abs/path/to/plugin.ts',
	name: 'shared-plugin',
})
```

Inyectando una instancia en un proceso:

```ts
const process = app.getProcess('smp')
if (process) {
	const plugin = new MyPlugin(process.createPluginContext())
	const unregister = await app.registerProcessPlugin({
		processName: 'smp',
		plugin,
		name: plugin.name,
	})
}
```

Inyectando por factory en varios procesos:

```ts
const unregister = await app.registerProcessPluginForMany({
	plugin: (context) => new MyPlugin(context),
	name: 'my-plugin',
})
```

Para reloads de mods, registra dentro de `onLoad()` y guarda el cleanup:

```ts
class MyMod extends Mod {
	async onLoad() {
		const unregister = await this.app.registerProcessPluginForMany({
			plugin: (context) => new MyPlugin(context),
			name: 'my-plugin',
		})

		this.addCleanup(unregister)
	}
}
```

### Helpers

Los helpers son utilidades compartidas para mods y plugins.

```ts
app.registerHelper<T>(name: string, helper: T): () => void
app.getHelper<T = unknown>(name: string): T | undefined
app.hasHelper(name: string): boolean
```

Registrar:

```ts
type BroadcastHelper = {
	broadcast(message: string): void
}

const unregister = this.app.registerHelper<BroadcastHelper>('broadcast', {
	broadcast: (message) => {
		for (const process of this.app.getProcesses()) {
			process.execute(`say ${message}`)
		}
	},
})

this.addCleanup(unregister)
```

Consumir desde un plugin o mod:

```ts
const broadcast = this.app.getHelper<BroadcastHelper>('broadcast')
broadcast?.broadcast('Mensaje global')
```

### Otros Metodos

```ts
app.run(token: string): Promise<void>
app.sendManagerLog(message: string): Promise<void>
app.reloadMods(): Promise<void>
```

## MinecraftProcess

`MinecraftProcess` es un `EventEmitter`.

Propiedades:

```ts
process.name: string
process.config: ProcessConfig
process.app: McDisApp
process.isRunning: boolean
process.cwd: string
process.currentState: 'stopped' | 'starting' | 'running' | 'stopping'
```

Metodos:

```ts
process.getStatusLine(): string
process.createPluginContext(): PluginContext
process.prepare(): Promise<void>
process.start(): Promise<void>
process.stop(): void
process.restart(): Promise<void>
process.kill(): void
process.execute(command: string): void
process.handleThreadCommand(messageOrCommand: Message | string): Promise<void>
process.reloadPlugins(): Promise<void>
process.registerPluginSource(source: RegisteredPluginSource): Promise<() => Promise<void>>
```

Ejemplo:

```ts
const process = this.app.getProcess('smp')
await process?.start()
process?.execute('say hola')
```

## Plugins

Los plugins viven dentro de cada proceso:

```txt
<cwd>/.mdplugins
```

Pueden ser archivos:

```txt
smp/.mdplugins/auto-save.ts
```

O directorios:

```txt
smp/.mdplugins/welcome/
  package.json
  src/index.ts
```

`package.json` usa `main`:

```json
{
	"name": "welcome",
	"type": "module",
	"main": "./src/index.ts"
}
```

Sin `package.json`, McDis busca:

```txt
plugin.ts
plugin.mjs
plugin.js
plugin.cjs
index.ts
index.mjs
index.js
index.cjs
```

### PluginContext

```ts
type PluginContext = {
	name: string
	cwd: string
	prefix: string
	app: McDisApp
	process: MinecraftProcess
	getStatus: () => string
	execute: (command: string) => void
	sendLog: (message: string) => void
}
```

### Clase Plugin

```ts
abstract class Plugin {
	name = this.constructor.name

	protected get process(): MinecraftProcess
	protected get app(): McDisApp

	protected listen(eventName: string | symbol, listener: (...args: unknown[]) => void): void
	protected once(eventName: string | symbol, listener: (...args: unknown[]) => void): void
	cleanup(): Promise<void>

	onLoad(): Promise<void>
	onUnload(): Promise<void>
	onStart(): Promise<void>
	onStop(): Promise<void>
	onConsoleLine(line: string): Promise<void>
	onDiscordMessage(message: Message, command: string): Promise<boolean | void>
}
```

`this.listen(...)` registra listeners en el proceso y se limpia automaticamente al recargar/descargar el plugin.

### Forma Del Plugin

Todo plugin exporta:

```ts
export async function load(context: PluginContext): Promise<Plugin>
```

Ejemplo:

```ts
import { Plugin, type PluginContext } from 'mcdis-node-recreation/plugin'
import type { Message } from 'discord.js'

class AutoSavePlugin extends Plugin {
	name = 'auto-save'

	async onLoad() {
		this.context.sendLog('auto-save loaded')
	}

	async onConsoleLine(line: string) {
		if (line.includes('Done')) {
			this.context.execute('save-on')
		}
	}

	async onDiscordMessage(_message: Message, command: string) {
		if (command === 'save-now') {
			this.context.execute('save-all flush')
			return true
		}
	}
}

export async function load(context: PluginContext) {
	return new AutoSavePlugin(context)
}
```

## Mods

Los mods viven globalmente:

```txt
.mdmods
```

Pueden ser archivos:

```txt
.mdmods/process-coordinator.ts
```

O directorios:

```txt
.mdmods/coordinator/
  package.json
  src/index.ts
```

`package.json` usa `main`:

```json
{
	"name": "coordinator",
	"type": "module",
	"main": "./src/index.ts"
}
```

Sin `package.json`, McDis busca:

```txt
mod.ts
mod.mjs
mod.js
mod.cjs
index.ts
index.mjs
index.js
index.cjs
```

### ModContext

```ts
type ModContext = {
	app: McDisApp
	prefix: string
	sendLog: (message: string) => void
}
```

### Clase Mod

```ts
abstract class Mod {
	name = this.constructor.name

	protected get app(): McDisApp

	protected listen(eventName: string | symbol, listener: (...args: unknown[]) => void): void
	protected once(eventName: string | symbol, listener: (...args: unknown[]) => void): void
	protected addCleanup(cleanup: () => void | Promise<void>): void
	cleanup(): Promise<void>

	onLoad(): Promise<void>
	onUnload(): Promise<void>
	onReady(): Promise<void>
	onShutdown(): Promise<void>
	onDiscordMessage(message: Message): Promise<boolean | void>
}
```

`this.listen(...)` escucha eventos en `McDisApp` y se limpia automaticamente en reload/unload.
`this.addCleanup(...)` registra limpiezas manuales, por ejemplo unregister de plugins o helpers.

### Forma Del Mod

Todo mod exporta:

```ts
export async function load(context: ModContext): Promise<Mod>
```

Ejemplo:

```ts
import { Mod, type ModContext } from 'mcdis-node-recreation/mod'

class CoordinatorMod extends Mod {
	name = 'coordinator'

	async onLoad() {
		this.listen('process:started', (process) => {
			this.context.sendLog(`Proceso iniciado: ${process.name}`)
		})
	}
}

export async function load(context: ModContext) {
	return new CoordinatorMod(context)
}
```

## Eventos

### Eventos De McDisApp

```txt
app:ready
app:shutdown
process:registered
process:event
mod:loaded
mod:unloaded
helper:registered
helper:unregistered
```

Ademas, todo evento emitido por un `MinecraftProcess` se reemite en `McDisApp` con el mismo nombre, y tambien como:

```txt
process:event
```

### Eventos De MinecraftProcess

```txt
process:prepare
process:starting
process:started
process:stopping
process:killing
process:stopped
process:command
console:line
discord:command
plugin:registered
plugin:unregistered
plugin:loaded
plugin:unloaded
```

Puedes crear eventos propios:

```ts
this.process.emit('server:ready', { process: this.context.name })
this.app.emit('cluster:ready')
```

## Comandos Discord

En panel:

```txt
!!start <process>
!!stop <process>
!!restart <process>
!!kill <process>
!!status <process>
!!status
!!start-all
!!stop-all
!!restart-all
!!kill-all
!!plugins-reload <process>
!!mdreload <process>
!!mods-reload
```

En thread `Console <process>`:

```txt
start
stop
restart
kill
status
plugins-reload
mdreload
```

Tambien puedes usar prefijo:

```txt
!!stop
!!save-now
```

Si el comando no es control interno, se manda al stdin del proceso.

## Cola De Discord

La consola se envia con cola global:

- Respeta `discord.queue.minIntervalMs`.
- Descarta mensajes antiguos si supera `discord.queue.maxQueuedMessages`.
- Divide mensajes largos.
- Envuelve logs en bloques de codigo.
- Usa `discord.queue.codeBlockLanguage`.

## Reloads

### Plugins

```txt
!!plugins-reload <process>
```

Recarga plugins del proceso:

- Descarga plugins actuales.
- Ejecuta `onUnload()`.
- Limpia listeners registrados con `this.listen(...)`.
- Vuelve a cargar archivos/directorios `.mdplugins`.
- Vuelve a cargar fuentes registradas por mods.

### Mods

```txt
!!mods-reload
```

Recarga mods:

- Ejecuta `onUnload()`.
- Ejecuta cleanups de `this.addCleanup(...)`.
- Remueve plugins/helpers registrados si guardaste sus unregister callbacks.
- Carga mods desde `.mdmods`.
- Ejecuta `onLoad()`.

Patron recomendado:

```ts
class MyMod extends Mod {
	async onLoad() {
		const unregisterHelper = this.app.registerHelper('x', {})
		this.addCleanup(unregisterHelper)

		const unregisterPlugin = await this.app.registerProcessPluginForMany({
			plugin: (context) => new MyPlugin(context),
			name: 'my-plugin',
		})
		this.addCleanup(unregisterPlugin)
	}
}
```
