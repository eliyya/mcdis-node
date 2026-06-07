# McDis Node Recreation

Recreacion en Node.js 24, TypeScript y ESM de la parte esencial de McDis-RCON: levantar procesos de Minecraft desde un archivo de configuracion, enviar la consola a threads de Discord y aceptar comandos remotos.

## Requisitos

- Node.js 24+
- Un bot de Discord con `MESSAGE CONTENT INTENT` habilitado
- Permisos del bot para leer/escribir mensajes y crear threads en el canal panel

## Configuracion rapida

```sh
pnpm install
cp .env.example .env
cp config.example.json config.json
```

Edita `.env`:

```env
DISCORD_TOKEN=tu-token
```

Edita `config.json` para definir el canal panel y las instancias de Minecraft:

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
			"stopCommand": "stop",
			"autoStart": false,
			"blacklist": [],
			"plugins": {
				"enabled": true,
				"directory": ".mdplugins"
			}
		}
	}
}
```

Si no defines `cwd`, McDis usa el nombre del proceso como carpeta. Por ejemplo, `"smp"` usa `cwd: "smp"` y `"velocity"` usa `cwd: "velocity"`.

## Uso

```sh
pnpm build
pnpm start -- --config config.json
```

Referencia completa de API: [API.md](API.md). Documentacion web y schema: [docs/index.html](docs/index.html).

En el canal panel puedes usar:

```txt
!!start smp
!!stop smp
!!restart smp
!!kill smp
!!status smp
!!plugins-reload smp
!!mods-reload
!!start-all
!!stop-all
```

En cada thread `Console <nombre>`:

- `start`, `stop`, `restart`, `kill`, `status` controlan la instancia.
- Tambien puedes usar el prefijo global dentro del thread: `!!start`, `!!stop`, `!!status`.
- `plugins-reload` o `mdreload` recarga los plugins del proceso.
- Si un mensaje usa el prefijo y no es comando de control, se envia al proceso sin el prefijo.
- Cualquier otro mensaje se envia al stdin del proceso.

## Plugins Por Proceso

Cada proceso crea una carpeta de plugins dentro de su `cwd`; por defecto es `.mdplugins`. Los plugins pueden ser archivos `.js`, `.mjs`, `.cjs` o `.ts`, o directorios con su propio entrypoint.

Cada plugin debe exportar una funcion asincrona `load(context)` que devuelve una instancia de una clase que hereda de `Plugin`.

Ejemplo `smp/.mdplugins/auto-save.ts`:

```ts
import { Plugin, type PluginContext } from 'mcdis-node-recreation/plugin'
import type { Message } from 'discord.js'

class AutoSavePlugin extends Plugin {
	name = 'auto-save'

	async onLoad() {
		this.context.sendLog('auto-save plugin loaded')

		this.listen('console:line', (line) => {
			if (typeof line === 'string' && line.includes('joined the game')) {
				this.context.execute('say Bienvenido al servidor!')
			}
		})
	}

	async onConsoleLine(line: string) {
		if (line.includes('Done')) {
			this.context.execute('save-on')
		}
	}

	async onDiscordMessage(message: Message, command: string) {
		if (command === 'save-now') {
			this.context.execute('save-all flush')
			this.context.sendLog(`Manual save requested by ${message.author.tag}`)
			return true
		}
	}

	async onUnload() {
		this.context.sendLog('auto-save plugin unloaded')
	}
}

export async function load(context: PluginContext) {
	return new AutoSavePlugin(context)
}
```

Los plugins `.ts` se importan directamente con Node 24, asi que deben usar TypeScript compatible con el type stripping nativo de Node.

Para plugins grandes puedes usar un directorio:

```txt
smp/.mdplugins/welcome/
  package.json
  src/
    index.ts
    messages.ts
```

`package.json` declara el entrypoint del plugin con `main`:

```json
{
	"name": "welcome",
	"type": "module",
	"main": "./src/index.ts"
}
```

Si no hay `package.json`, McDis busca automaticamente estos entrypoints en la raiz del directorio:

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

El entrypoint del directorio debe exportar la misma funcion `load(context)`.

Hooks disponibles: `onLoad`, `onUnload`, `onStart`, `onStop`, `onConsoleLine` y `onDiscordMessage`. Si `onDiscordMessage` retorna `true`, McDis no envia ese mensaje al stdin del proceso.

El `context.process` es un `EventEmitter`, asi que los plugins tambien pueden escuchar eventos del proceso o emitir eventos propios para comunicarse entre ellos.
El `context.app` apunta a la instancia de `McDisApp`; dentro de una clase `Plugin` tambien puedes usar `this.app` y `this.process`.

Eventos emitidos por McDis:

- `process:prepare`
- `process:starting`
- `process:started`
- `process:stopping`
- `process:killing`
- `process:stopped`
- `process:command`
- `console:line`
- `discord:command`
- `plugin:loaded`
- `plugin:unloaded`

Ejemplo de comunicacion entre plugins:

```ts
import { Plugin, type PluginContext } from 'mcdis-node-recreation/plugin'

class BroadcasterPlugin extends Plugin {
	async onConsoleLine(line: string) {
		if (line.includes('Done')) {
			this.process.emit('server:ready', { process: this.context.name })
		}
	}
}

export async function load(context: PluginContext) {
	return new BroadcasterPlugin(context)
}
```

```ts
import { Plugin, type PluginContext } from 'mcdis-node-recreation/plugin'

class ListenerPlugin extends Plugin {
	async onLoad() {
		this.listen('server:ready', (payload) => {
			this.context.sendLog(`Evento recibido: ${JSON.stringify(payload)}`)
		})

		const processNames = this.app
			.getProcesses()
			.map((process) => process.name)
			.join(', ')
		this.context.sendLog(`Procesos cargados: ${processNames}`)
	}
}

export async function load(context: PluginContext) {
	return new ListenerPlugin(context)
}
```

Usa `this.listen(...)` dentro de plugins para que esos listeners se limpien automaticamente al recargar o descargar plugins.

## Mods Globales

Los mods son extensiones globales, pensadas para coordinar varios procesos. No viven dentro de un proceso; por defecto se cargan desde:

```txt
./.mdmods
```

Se configuran en la raiz de `config.json`:

```json
{
	"mods": {
		"enabled": true,
		"directory": ".mdmods"
	}
}
```

Igual que los plugins, pueden ser archivos `.js`, `.mjs`, `.cjs`, `.ts` o directorios con entrypoint. Para directorios puedes usar `package.json`:

```json
{
	"name": "process-coordinator",
	"type": "module",
	"main": "./src/index.ts"
}
```

Si no hay `package.json`, McDis busca:

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

Ejemplo `.mdmods/process-coordinator.ts`:

```ts
import { Mod, type ModContext } from 'mcdis-node-recreation/mod'
import type { MinecraftProcess } from 'mcdis-node-recreation/plugin'

class ProcessCoordinator extends Mod {
	name = 'process-coordinator'

	async onLoad() {
		this.context.sendLog('Mod global cargado.')

		this.listen('process:started', (process) => {
			const minecraftProcess = process as MinecraftProcess
			this.context.sendLog(`${minecraftProcess.name} inicio.`)
		})

		this.listen('server:ready', (payload) => {
			this.context.sendLog(`Evento global server:ready: ${JSON.stringify(payload)}`)
		})
	}

	async onReady() {
		const names = this.app
			.getProcesses()
			.map((process) => process.name)
			.join(', ')
		this.context.sendLog(`Procesos disponibles: ${names}`)
	}
}

export async function load(context: ModContext) {
	return new ProcessCoordinator(context)
}
```

`McDisApp` tambien es un `EventEmitter`. Todos los eventos emitidos por un `MinecraftProcess` se reemiten en la app, asi que un mod puede escuchar eventos de todos los procesos desde un solo lugar. Los mods tambien pueden comunicarse entre ellos con `this.app.emit(...)` o `this.listen(...)`.

Los mods tambien pueden registrar plugins en procesos. Esto sirve cuando un mod global necesita instalar comportamiento local en uno o varios procesos sin copiar archivos dentro de cada `.mdplugins`.

Ejemplo:

```txt
.mdmods/shared-welcome/
  package.json
  src/
    mod.ts
    process-plugin.ts
```

`package.json`:

```json
{
	"name": "shared-welcome",
	"type": "module",
	"main": "./src/mod.ts"
}
```

`src/mod.ts`:

```ts
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Mod, type ModContext } from 'mcdis-node-recreation/mod'

const dirname = path.dirname(fileURLToPath(import.meta.url))

class SharedWelcomeMod extends Mod {
	name = 'shared-welcome'

	async onLoad() {
		const unregister = await this.app.registerProcessPluginForMany({
			file: path.join(dirname, 'process-plugin.ts'),
			name: 'shared-welcome-process-plugin',
		})

		this.addCleanup(unregister)
		this.context.sendLog('Shared welcome process plugin registered.')
	}
}

export async function load(context: ModContext) {
	return new SharedWelcomeMod(context)
}
```

`src/process-plugin.ts`:

```ts
import { Plugin, type PluginContext } from 'mcdis-node-recreation/plugin'

class SharedWelcomeProcessPlugin extends Plugin {
	name = 'shared-welcome-process-plugin'

	async onConsoleLine(line: string) {
		if (line.includes('joined the game')) {
			this.context.execute('say Bienvenido!')
		}
	}
}

export async function load(context: PluginContext) {
	return new SharedWelcomeProcessPlugin(context)
}
```

Importante para reloads: registra los plugins dentro de `onLoad()` y guarda el cleanup con `this.addCleanup(unregister)`. Cuando ejecutas `!!mods-reload`, McDis descarga el mod anterior, desregistra esos plugins, vuelve a cargar el mod y ejecuta `onLoad()` otra vez, dejando el registro establecido de nuevo.

Tambien puedes registrar en un solo proceso:

```ts
const unregister = await this.app.registerProcessPlugin({
	processName: 'smp',
	file: path.join(dirname, 'process-plugin.ts'),
	name: 'shared-welcome-smp',
})

this.addCleanup(unregister)
```

Tambien puedes inyectar una instancia de `Plugin` directamente, sin usar un archivo:

```ts
import { Mod, type ModContext } from 'mcdis-node-recreation/mod'
import { Plugin, type PluginContext } from 'mcdis-node-recreation/plugin'

class InlineWelcomePlugin extends Plugin {
	name = 'inline-welcome'

	async onConsoleLine(line: string) {
		if (line.includes('joined the game')) {
			this.context.execute('say Bienvenido desde un plugin inyectado!')
		}
	}
}

class InlinePluginMod extends Mod {
	async onLoad() {
		const process = this.app.getProcess('smp')
		if (!process) {
			return
		}

		const plugin = new InlineWelcomePlugin(process.createPluginContext())

		const unregister = await this.app.registerProcessPlugin({
			processName: 'smp',
			plugin,
			name: plugin.name,
		})

		this.addCleanup(unregister)
	}
}

export async function load(context: ModContext) {
	return new InlinePluginMod(context)
}
```

Para registrar el mismo tipo de plugin en varios procesos, usa una factory. McDis creara una instancia distinta por proceso:

```ts
const unregister = await this.app.registerProcessPluginForMany({
	plugin: (context: PluginContext) => new InlineWelcomePlugin(context),
	name: 'inline-welcome',
})

this.addCleanup(unregister)
```

Eventos globales propios:

- `app:ready`
- `app:shutdown`
- `process:registered`
- `process:event`
- `mod:loaded`
- `mod:unloaded`
- `helper:registered`
- `helper:unregistered`

Los mods pueden publicar helpers compartidos en `McDisApp` para que otros mods y plugins los usen:

```ts
type BroadcastHelper = {
	broadcast: (message: string) => void
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

Otro mod o plugin puede leerlo:

```ts
const broadcast = this.app.getHelper<BroadcastHelper>('broadcast')
broadcast?.broadcast('Mensaje global')
```

Guarda el cleanup con `this.addCleanup(unregister)` para que el helper se quite antes de `!!mods-reload` y se registre nuevamente en `onLoad()`.

Recarga mods desde el panel:

```txt
!!mods-reload
```

## Cola de Discord

La consola se envia mediante una cola global. Cada envio:

- Respeta `discord.queue.minIntervalMs`.
- Divide logs largos para quedar debajo del maximo de Discord.
- Envuelve el contenido en bloques de codigo: ` ```md ... ``` `.
- Sanitiza backticks y codigos ANSI para que la consola no rompa Markdown.
