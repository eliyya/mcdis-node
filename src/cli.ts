import { Events, GatewayIntentBits } from 'discord.js'
import { McDisClient } from './client.ts'
import { config } from './options.ts'

const client = await new Promise<McDisClient>(res => {
    const client = new McDisClient({
        intents: GatewayIntentBits.MessageContent,
    })
    client.on(Events.ClientReady, res)
    client.login(config.DISCORD_TOKEN)
})
