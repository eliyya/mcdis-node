import {
    Client,
    type ClientOptions,
    type ClientEvents as DiscordClientEvents,
    Events as DiscordEvents,
} from 'discord.js'
import type { McDisOptions } from './options.ts'
import { spawn } from 'node-pty'
import EventEmitter from 'node:events'

const McDisEvents = {
    McChunk: 'mcChunk',
} as const
type McDisEvents = DiscordEvents & typeof McDisEvents

type ServerName = string
type ClientEvents = DiscordClientEvents & {
    [McDisEvents.McChunk]: [chunk: string]
}
const DiscordEventsStrings: (string | Symbol)[] = Object.values(DiscordEvents)
export class McDisClient extends EventEmitter<ClientEvents> {
    servers = new Map<ServerName, Server>()
    #discord: Client<true>

    get discord() {
        return this.#discord
    }

    constructor({
        servers,
        ...options
    }: ClientOptions & {
        servers: McDisOptions['servers']
    }) {
        super()
        /**
         * DISCORD SETUP
         */
        this.#discord = new Client<true>(options)
        this.on('newListener', (event, listener) => {
            if (DiscordEventsStrings.includes(event)) {
                this.#discord.on(event, listener)
            }
        })
        this.on('removeListener', (event, listener) => {
            if (DiscordEventsStrings.includes(event)) {
                this.#discord.off(event, listener)
            }
        })

        /**
         * SERVER SETUPS
         */
        const names = new Set<string>()
        for (const { name, start, end, path } of servers) {
            if (names.has(name)) {
                console.log(
                    `Existe más de un servidor "${name}", sólo será cargado uno`,
                )
                continue
            }
            this.servers.set(
                name,
                new Server({ name, start, end, path, client: this }),
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

class Server implements ServerOptions {
    name: string
    start: string
    end: string
    path: string
    client: McDisClient
    #isOn = false

    get isOn() {
        return this.#isOn
    }

    constructor({ end, name, start, client, path }: ServerOptions) {
        this.end = end
        this.start = start
        this.name = name
        this.client = client
        this.path = path
    }

    spawn() {
        const [f, ...r] = this.start.split(/\s+/)
        if (typeof f === 'undefined') {
            console.log(
                `el proceso "${this.name}" no tiene configurado un "start", será omitido`,
            )
            return
        }
        const process = spawn(f, r, {
            name: 'xterm-color',
            cwd: this.path,
        })
        this.#isOn = true
        process.onData(chunk => {
            this.client.emit(chunk)
            // TODO: send to discord
        })
    }
}
