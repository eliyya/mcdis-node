import {
    Client as DiscordClient,
    type ClientOptions as DiscordClientOptions,
    type ClientEvents as DiscordClientEvents,
    Events as DiscordEvents,
    type Channel,
    type SendableChannels,
} from 'discord.js'
import type { McDisOptions } from './options.ts'
import { spawn } from 'node-pty'
import EventEmitter from 'node:events'
import { th } from 'zod/v4/locales'

const CustomEvents = {
    McChunk: 'mcChunk',
} as const

const DiscordEventsMaped = Object.fromEntries(
    Object.entries(DiscordEvents).map(([k, v]) => [
        'Discord' + k[0]!.toUpperCase() + k.substring(1),
        'discord' + v[0]!.toUpperCase() + v.substring(1),
    ]),
) as EventsMap<DiscordEvents>

const McDisEvents = {
    ...CustomEvents,
    ...DiscordEvents,
} as unknown as typeof DiscordEventsMaped & typeof CustomEvents

export type McDisEvents = (typeof McDisEvents)[keyof typeof McDisEvents]

type If<Value extends boolean, TrueResult, FalseResult = null> =
    Value extends true ? TrueResult
    : Value extends false ? FalseResult
    : TrueResult | FalseResult

type EventsMap<T extends string> = {
    readonly [K in T as `Discord${Capitalize<`${K}`>}`]: `discord${Capitalize<`${K}`>}`
}

type PrefixDiscord<T> = {
    [K in keyof T as `discord${Capitalize<string & K>}`]: T[K]
}
type ServerName = string
export type ClientEvents = PrefixDiscord<DiscordClientEvents> & {
    [McDisEvents.McChunk]: [chunk: McChunk]
}

const DiscordEventsStrings: (string | Symbol)[] = Object.values(
    DiscordEvents,
).map(ev => `discord${ev[0]?.toUpperCase()}${ev.substring(1)}`)

export class McDisClient extends EventEmitter<ClientEvents> {
    servers = new Map<ServerName, Server>()
    #discord: DiscordClient<true>

    get discord() {
        return this.#discord
    }

    constructor({
        servers,
        ...options
    }: DiscordClientOptions & {
        servers: McDisOptions['servers']
    }) {
        super()
        /**
         * DISCORD SETUP
         */
        this.#discord = new DiscordClient<true>(options)
        this.on('newListener', (event, listener) => {
            if (DiscordEventsStrings.includes(event)) {
                let ev = event.toString().replace('discord', '')
                ev = ev[0]!.toLocaleLowerCase() + ev.substring(1)
                this.#discord.on(ev, listener)
            }
        })
        this.on('removeListener', (event, listener) => {
            if (DiscordEventsStrings.includes(event)) {
                let ev = event.toString().replace('discord', '')
                ev = ev[0]!.toLocaleLowerCase() + ev.substring(1)
                this.#discord.off(event, listener)
            }
        })

        /**
         * SERVER SETUPS
         */
        const names = new Set<string>()
        for (const { name, ...conf } of servers) {
            if (names.has(name)) {
                console.log(
                    `Existe más de un servidor "${name}", sólo será cargado uno`,
                )
                continue
            }
            this.servers.set(
                name,
                new Server({
                    name,
                    ...conf,
                    client: this,
                }),
            )
            names.add(name)
        }
    }

    startServers() {
        for (const server of this.servers.values()) {
            server.spawn()
        }
    }
}

type McDisOptionsSever = McDisOptions['servers'][number]
interface ServerOptions extends McDisOptionsSever {
    client: McDisClient
}

class Server<Ready extends boolean = boolean> {
    #name: string

    get name(): string {
        return this.#name
    }

    #start: string

    get start(): string {
        return this.#start
    }

    #end: string

    get end(): string {
        return this.#end
    }

    #path: string

    get path() {
        return this.#path
    }

    #client: McDisClient

    get client() {
        return this.#client
    }

    #console_channel_id: string

    get consoleChannelId() {
        return this.#console_channel_id
    }

    #console_channel: SendableChannels | null = null

    get discordChannel(): If<Ready, SendableChannels> {
        return this.#console_channel as If<Ready, SendableChannels>
    }

    #isOn = false

    isOn(): this is Server<true> {
        return this.#isOn
    }

    isOff(): this is Server<false> {
        return this.#isOn
    }

    #queue: string[] = []

    constructor({
        end,
        name,
        start,
        client,
        path,
        console_channel: discord_channel,
    }: ServerOptions) {
        this.#end = end
        this.#start = start
        this.#name = name
        this.#client = client
        this.#path = path
        this.#console_channel_id = discord_channel
    }

    async spawn() {
        const console_channel = await this.#client.discord.channels.fetch(
            this.#console_channel_id,
        )
        if (!console_channel) {
            console.log(
                `el canal para el proceso "${this.#name}" no ha sido omitido, será omitido`,
            )
            return this.#client.servers.delete(this.name)
        }
        if (!console_channel.isSendable()) {
            console.log(
                `el canal para el proceso "${this.#name}" no es de texto, será omitido`,
            )
            return this.#client.servers.delete(this.name)
        }
        this.#console_channel = console_channel

        const [f, ...r] = this.#start.split(/\s+/)
        if (typeof f === 'undefined') {
            console.log(
                `el proceso "${this.#name}" no tiene configurado un "start", será omitido`,
            )
            return this.#client.servers.delete(this.name)
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
            await console_channel.send('```sh\n' + chunk + '\n```')
        }, 1_000)
        process.onExit(e => {
            this.#isOn = false
            clearInterval(interval)
        })
    }
}

class McChunk {
    #chunk: string

    get chunk() {
        return this.#chunk
    }

    #server: Server

    get server() {
        return this.#server
    }

    constructor(chunk: string, server: Server) {
        this.#chunk = chunk
        this.#server = server
    }
}

function splitTextByLimit(
    text: string,
    max = 1024,
): {
    chunk: string
    rest: string
} {
    let total = 0
    const lines = text.split(/\r?\n/)

    const taken: string[] = []
    let index = 0

    for (; index < lines.length; index++) {
        const line = lines[index]!
        const length = line.length + 1

        if (total + length > max) {
            break
        }

        total += length
        taken.push(line)
    }

    return {
        chunk: taken.join('\n'),
        rest: lines.slice(index).join('\n'),
    }
}
