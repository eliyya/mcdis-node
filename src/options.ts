import { readFile, mkdir, access } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { logger } from './logger.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as z from 'zod'

const optionsSchema = z.object({
    discord_token: z
        .string()
        .min(1, { error: 'El "discord_token" es necesario' }),
    guild_id: z.string().min(1, {
        error: 'El "guild_id" es necesario',
    }),
    servers: z.array(
        z.object({
            name: z.string().min(1, { error: 'Coloca un nombre al servidor' }),
            start: z.string().min(1, {
                error: 'Coloca un comando para iniciar el servidor',
            }),
            end: z.string().min(1, {
                error: 'Coloca un comando para finalizar el servidor',
            }),
            path: z
                .string()
                .min(1)
                .refine(
                    async value => {
                        try {
                            await access(value)
                            return true
                        } catch {
                            return false
                        }
                    },
                    {
                        message: 'Ruta no accesible',
                    },
                ),
            console_channel: z.string().min(1, {
                error: 'Debes incluir el id del canal de discord',
            }),
        }),
    ),
})

export type McDisOptions = z.output<typeof optionsSchema>

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
    await mkdir(join(homedir(), '.mcdis'), { recursive: true })
} catch (error) {}

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

const { success, data, error } = optionsSchema.safeParse(configUnparsed)
if (!success) {
    logger.error(z.prettifyError(error))
    process.exit(1)
}

export const config = data
