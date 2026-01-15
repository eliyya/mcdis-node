import { Events, GatewayIntentBits } from 'discord.js'
import { McDisClient } from './client.ts'
import { config } from './options.ts'

const client = await new Promise<McDisClient>(res => {
    const client = new McDisClient({
        servers: config.servers,
        intents:
            GatewayIntentBits.Guilds |
            GatewayIntentBits.GuildMembers |
            GatewayIntentBits.GuildModeration |
            GatewayIntentBits.GuildExpressions |
            GatewayIntentBits.GuildIntegrations |
            GatewayIntentBits.GuildWebhooks |
            GatewayIntentBits.GuildInvites |
            GatewayIntentBits.GuildVoiceStates |
            GatewayIntentBits.GuildPresences |
            GatewayIntentBits.GuildMessages |
            GatewayIntentBits.GuildMessageReactions |
            GatewayIntentBits.GuildMessageTyping |
            GatewayIntentBits.DirectMessages |
            GatewayIntentBits.DirectMessageReactions |
            GatewayIntentBits.DirectMessageTyping |
            GatewayIntentBits.MessageContent |
            GatewayIntentBits.GuildScheduledEvents |
            GatewayIntentBits.AutoModerationConfiguration |
            GatewayIntentBits.AutoModerationExecution |
            GatewayIntentBits.GuildMessagePolls |
            GatewayIntentBits.DirectMessagePolls,
    })
    client.on(Events.ClientReady, () => {
        if (import.meta.main) {
            client.startServers()
        }
        res(client)
    })
    client.discord.login(config.DISCORD_TOKEN)
})
