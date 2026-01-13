import { Events, GatewayIntentBits } from 'discord.js'
import { readFile } from 'node:fs/promises'
import { McDisClient } from './client.ts'
import { parseArgs } from 'node:util'
import { logger } from './logger.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as z from 'zod'

const optionsSchema = z.object({
    DISCORD_TOKEN: z.string({
        error: issue =>
            typeof issue === 'undefined' ?
                'El "DISCORD_TOKEN" es necesario'
            :   'El "DISCORD_TOKEN" debe ser un texto',
    }),
})

const {
    values: { config: configArg },
} = parseArgs({
    options: {
        config: {
            type: 'string',
            short: 'c',
            default: join(homedir(), '.mcdis', 'config.json'),
            multiple: false,
        },
    },
})

let dataConfig = ''

try {
    dataConfig = await readFile(configArg, { encoding: 'utf-8' })
} catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        logger.error(`El archivo "${configArg}" no existe`)
    } else {
        console.error(error)
        // TODO: add link
        logger.error(
            'Ha ocurrido un error inesperado. Por favor reportalo a {issues} si tienes la oportunidad',
        )
    }
    process.exit(1)
}

let configUnparsed = {}
try {
    configUnparsed = JSON.parse(dataConfig)
} catch (error) {
    if (error instanceof SyntaxError) {
        logger.error(
            `El contenido de "${configArg}" no es un json o está mal formateado`,
        )
    } else {
        console.error(error)
        // TODO: add link
        logger.error(
            'Ha ocurrido un error inesperado. Por favor reportalo a {issues} si tienes la oportunidad',
        )
    }
    process.exit(1)
}

const { success, data: config, error } = optionsSchema.safeParse(configUnparsed)
if (!success) {
    logger.error(z.prettifyError(error))
    process.exit(1)
}

const client = await new Promise<McDisClient>(res => {
    const client = new McDisClient({
        intents: GatewayIntentBits.MessageContent,
    })
    client.on(Events.ClientReady, res)
    client.login(config.DISCORD_TOKEN)
})
