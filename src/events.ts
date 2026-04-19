import {
    Events as DiscordEvents,
    type ClientEvents as DiscordClientEvents,
} from 'discord.js'
import type { McChunk } from './types.ts'

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

export type McDisEventString = (typeof McDisEvents)[keyof typeof McDisEvents]

export type ClientEvents = PrefixDiscord<DiscordClientEvents> & {
    [McDisEvents.McChunk]: [chunk: McChunk]
}

type EventsMap<T extends string> = {
    readonly [K in T as `Discord${Capitalize<`${K}`>}`]: `discord${Capitalize<`${K}`>}`
}

type PrefixDiscord<T> = {
    [K in keyof T as `discord${Capitalize<string & K>}`]: T[K]
}

type DiscordEventsStringMaped =
    (typeof DiscordEventsMaped)[keyof typeof DiscordEventsMaped]

export const DiscordEventsStrings: DiscordEventsStringMaped[] = Object.values(
    DiscordEvents,
).map(
    ev =>
        `discord${ev[0]?.toUpperCase()}${ev.substring(1)}` as DiscordEventsStringMaped,
)
