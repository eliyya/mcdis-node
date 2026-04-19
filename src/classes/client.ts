import { EventEmitter } from 'node:events'
import {
    Client as DiscordClient,
    type ClientOptions as DiscordClientOptions,
} from 'discord.js'

import type { McDisOptions } from '../options.ts'
import { Process } from './process.ts'
import { DiscordEventsStrings, type ClientEvents } from '../events.ts'

type ServerName = string

export class McDisClient extends EventEmitter<ClientEvents> {
    processes = new Map<ServerName, Process>()
    #discord: DiscordClient<true>
    #prefix = '!'
    #path = process.cwd()
    #config: Record<string, string> = {}
    #addons = new Set<object>()

    get discord() {
        return this.#discord
    }

    constructor({
        servers,
        prefix,
        ...options
    }: DiscordClientOptions & {
        servers: McDisOptions['servers']
        prefix: McDisOptions['prefix']
    }) {
        super()
        this.#prefix = prefix ?? '!'
        /**
         * DISCORD SETUP
         */
        this.#discord = new DiscordClient<true>(options)
        this.on('newListener', (event, listener) => {
            if (typeof event !== 'string') return
            if ((DiscordEventsStrings as string[]).includes(event)) {
                let ev = event.toString().replace('discord', '')
                ev = ev[0]!.toLocaleLowerCase() + ev.substring(1)
                this.#discord.on(ev, listener)
            }
        })
        this.on('removeListener', (event, listener) => {
            if (typeof event !== 'string') return
            if ((DiscordEventsStrings as string[]).includes(event)) {
                let ev = event.toString().replace('discord', '')
                ev = ev[0]!.toLocaleLowerCase() + ev.substring(1)
                this.#discord.off(event, listener)
            }
        })

        /**
         * PROCESS SETUPS
         */
        const names = new Set<string>()
        for (const { name, ...conf } of servers) {
            if (names.has(name)) {
                console.log(
                    `Existe más de un proceso "${name}", sólo será cargado uno`,
                )
                continue
            }
            this.processes.set(
                name,
                new Process({
                    name,
                    ...conf,
                    client: this,
                }),
            )
            names.add(name)
        }
    }

    startServers() {
        for (const server of this.processes.values()) {
            server.start()
        }
    }
    // TODO: add log method
}
