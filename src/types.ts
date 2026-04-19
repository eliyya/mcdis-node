import type { McDisClient } from "./classes/client.ts"
import type { McDisOptions } from "./options.ts"
import { McDisEvents } from "./classes/client.ts"

type McDisOptionsSever = McDisOptions['servers'][number]

export interface ServerOptions extends McDisOptionsSever {
    client: McDisClient
}

export interface Process<ON extends boolean = boolean> {
    name: string
    path: string
    client: McDisClient
    prefix: string
    pathPlugins: string
    pathCommands: string
    startCommand: string
    endCommand: string
    readonly plugins: Object[]
    isOn(): this is Process<true>
    isOff(): this is Process<false>
    start(): Promise<void>
}

export interface McChunk {
    chunk: string
    process: Process
}
