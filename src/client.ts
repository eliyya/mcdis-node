import { Client, type ClientOptions } from 'discord.js'
import type { McDisOptions } from './options.ts'
import { Server } from './Server.ts'

export class McDisClient extends Client<true> {
    servers: Server[] = []
    constructor({
        servers,
        ...options
    }: ClientOptions & {
        servers: McDisOptions['servers']
    }) {
        super(options)
        const names = new Set<string>()
        for (const { name, start, end } of servers) {
            if (names.has(name)) {
                console.log(
                    `Existe más de un servidor "${name}", sólo será cargado uno`,
                )
                continue
            }
            this.servers.push(new Server({ name, start, end }))
            names.add(name)
        }
    }
    startServers() {
        for (const server of this.servers) {
            server.spawn()
        }
    }
}
