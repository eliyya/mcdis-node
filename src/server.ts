import { spawn } from 'node-pty'

interface ServerOptions {
    name: string
    start: string
    end: string
}

export class Server {
    name: string
    start: string
    end: string

    constructor({ end, name, start }: ServerOptions) {
        this.end = end
        this.start = start
        this.name = name
    }

    spawn() {
        const [f, ...r] = this.start.split(/\s+/)
        if (typeof f === 'undefined') {
            console.log(
                `el proceso "${this.name}" no tiene configurado un "start", será omitido`,
            )
            return
        }
        spawn(f, r, {
            name: 'xterm-color',
        })
    }
}
