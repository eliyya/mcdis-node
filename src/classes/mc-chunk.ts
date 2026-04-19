import type { Process, McChunk as McChunkInterface } from "../types.ts"

export class McChunk implements McChunkInterface {
    #chunk: string

    get chunk() {
        return this.#chunk
    }

    #process: Process

    get process() {
        return this.#process
    }

    constructor(chunk: string, process: Process) {
        this.#chunk = chunk
        this.#process = process
    }
}