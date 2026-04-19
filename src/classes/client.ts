import { EventEmitter } from "node:events"
import {
    Client as DiscordClient,
    type ClientOptions as DiscordClientOptions,
    type ClientEvents as DiscordClientEvents,
    Events as DiscordEvents,
} from 'discord.js'

import type { McDisOptions } from "../options.ts"
import { spawn } from 'node-pty'
import type { McChunk, ServerOptions } from "../types.ts"
import { Process } from "./process.ts"

const CustomEvents = {
    McChunk: 'mcChunk',
} as const

const DiscordEventsMaped = Object.fromEntries(
    Object.entries(DiscordEvents).map(([k, v]) => [
        'Discord' + k[0]!.toUpperCase() + k.substring(1),
        'discord' + v[0]!.toUpperCase() + v.substring(1),
    ]),
) as EventsMap<DiscordEvents>

export const McDisEvents = {
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

export type ClientEvents = PrefixDiscord<DiscordClientEvents> & {
    [McDisEvents.McChunk]: [chunk: McChunk]
}

const DiscordEventsStrings: (string | Symbol)[] = Object.values(
    DiscordEvents,
).map(ev => `discord${ev[0]?.toUpperCase()}${ev.substring(1)}`)

type ServerName = string

export class McDisClient extends EventEmitter<ClientEvents> {
    servers = new Map<ServerName, Process>()
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
        for (const server of this.servers.values()) {
            server.start()
        }
    }
    // TODO: add log method
}