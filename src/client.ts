import {
    Client,
    Events,
    GatewayIntentBits,
    type ClientOptions,
} from 'discord.js'

class McDisClient extends Client<true> {
    constructor({ ...options }: ClientOptions) {
        super(options)
    }
}

export const client = await new Promise<McDisClient>(res => {
    const client = new McDisClient({
        intents: GatewayIntentBits.MessageContent,
    })
    client.on(Events.ClientReady, res)
    client.login('')
})
