import { Client, type ClientOptions } from 'discord.js'

export class McDisClient extends Client<true> {
    constructor({ ...options }: ClientOptions) {
        super(options)
    }
}
