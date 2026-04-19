import { spawn } from 'node-pty'
import { McDisEvents, type McDisClient } from './client.ts'
import type { Process as ProcesInterface, ServerOptions } from '../types.ts'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { McChunk } from './mc-chunk.ts'
import { splitTextByLimit } from '../utils.ts'

export class Process<
    ON extends boolean = boolean,
> implements ProcesInterface<ON> {
    #name: string
    #path: string
    #client: McDisClient
    #prefix: string
    #pathPlugins: string
    #pathCommands: string
    #startCommand: string
    #endCommand: string
    #plugins: Object[] = []
    #process: ReturnType<typeof spawn> | null = null
    #isOn = false
    #queue: string[] = []

    get name(): string {
        return this.#name
    }

    get startCommand(): string {
        return this.#startCommand
    }

    get endCommand(): string {
        return this.#endCommand
    }

    get path() {
        return this.#path
    }

    get client() {
        return this.#client
    }

    get prefix() {
        return this.#prefix
    }

    get pathPlugins() {
        return this.#pathPlugins
    }

    get pathCommands() {
        return this.#pathCommands
    }

    get plugins() {
        return this.#plugins
    }

    constructor({ end, name, start, client, path, prefix }: ServerOptions) {
        this.#endCommand = end
        this.#startCommand = start
        this.#name = name
        this.#client = client
        this.#prefix = prefix
        this.#path = path
        this.#pathCommands = join(path, '.mcdis_commands')
        this.#pathPlugins = join(path, '.mcdis_plugins')
        this.#makeDirs()
    }

    async #makeDirs() {
        await mkdir(this.#pathCommands, { recursive: true })
        await mkdir(this.#pathPlugins, { recursive: true })
    }

    isOn(): this is Process<true> {
        return this.#isOn
    }

    isOff(): this is Process<false> {
        return this.#isOn
    }

    async start() {
        const [f, ...r] = this.#startCommand.split(/\s+/)
        if (typeof f === 'undefined') {
            console.log(
                `el proceso "${this.#name}" no tiene configurado un "start", será omitido`,
            )
            return void this.#client.servers.delete(this.name)
        }
        const process = spawn(f, r, {
            name: 'xterm-color',
            cwd: this.#path,
        })

        this.#isOn = true
        process.onData(chunk => {
            this.#client.emit(McDisEvents.McChunk, new McChunk(chunk, this))
            this.#queue.push(chunk)
        })

        const interval = setInterval(async () => {
            if (this.#queue.length === 0) return
            const chunks = this.#queue.splice(0).join('\n')
            const { chunk, rest } = splitTextByLimit(chunks, 1014)
            this.#queue.unshift(rest)
            // this.#client.log('```sh\n' + chunk + '\n```')
        }, 1_000)

        process.onExit(e => {
            this.#isOn = false
            clearInterval(interval)
        })
    }
}
