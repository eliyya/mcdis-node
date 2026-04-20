import stripAnsi from 'strip-ansi'

import readline from 'readline'
import { TerminalParser, type InputEvent } from './terminal.ts'

export class ConsoleUI {
    #input = ''
    #cursor = 0
    #logs: string[] = []
    #scrollOffset = 0 // 0 = pegado abajo (auto-scroll)
    #isUserScrolling = false
    #currentProcess = 'mcdis (.)'
    #parser = new TerminalParser()
    #mouseEnabled = true

    onCommand?: (cmd: string) => void

    constructor() {
        process.stdin.setRawMode(true)
        process.stdin.resume()
        process.stdin.setEncoding('utf8')

        process.stdout.write('\x1b[?1000h')
        process.stdout.write('\x1b[?1006h')

        process.stdin.on('data', data => {
            const events = this.#parser.parse(`${data}`)

            for (const e of events) {
                this.#handleEvent(e)
            }
        })

        this.render()
    }

    enableMouse() {
        if (this.#mouseEnabled) return
        this.#mouseEnabled = true

        process.stdout.write('\x1b[?1000h')
        process.stdout.write('\x1b[?1006h')
        process.stdout.write('\x1b[?1002h')
    }

    disableMouse() {
        if (!this.#mouseEnabled) return
        this.#mouseEnabled = false

        process.stdout.write('\x1b[?1000l')
        process.stdout.write('\x1b[?1006l')
        process.stdout.write('\x1b[?1002l')
    }

    #handleEvent(e: InputEvent) {
        if (e.type === 'mouse') {
            const maxOffset = Math.max(0, this.#logs.length - 1)

            if (e.action === 'scrollUp') {
                this.#scrollOffset = Math.min(this.#scrollOffset + 1, maxOffset)
                this.#isUserScrolling = true
                return this.render()
            }

            if (e.action === 'scrollDown') {
                this.#scrollOffset = Math.max(this.#scrollOffset - 1, 0)

                if (this.#scrollOffset === 0) {
                    this.#isUserScrolling = false
                }

                return this.render()
            }
        }

        if (e.type === 'key') {
            if (e.name === 'ctrl+e') {
                if (this.#mouseEnabled) {
                    this.disableMouse()
                } else {
                    this.enableMouse()
                }
                return
            }

            if (e.name === 'ctrl+c') {
                this.destroy()
                process.exit()
            }

            if (e.name === 'return') {
                this.log(`> ${this.#input}`)
                this.onCommand?.(this.#input)
                this.#input = ''
                this.#cursor = 0
                return this.#renderInput()
            }

            if (e.name === 'left') {
                if (this.#cursor > 0) {
                    this.#cursor--
                    readline.moveCursor(process.stdout, -1, 0)
                }
                return
            }

            if (e.name === 'right') {
                if (this.#cursor < this.#input.length) {
                    this.#cursor++
                    readline.moveCursor(process.stdout, 1, 0)
                }
                return
            }

            if (e.name === 'backspace') {
                if (this.#cursor > 0) {
                    this.#input =
                        this.#input.slice(0, this.#cursor - 1) +
                        this.#input.slice(this.#cursor)

                    this.#cursor--
                    this.#renderInput()
                }
                return
            }

            if (e.name === 'up') {
                this.#scrollOffset++
                this.#isUserScrolling = true
                return this.render()
            }

            if (e.name === 'down') {
                this.#scrollOffset = Math.max(this.#scrollOffset - 1, 0)
                return this.render()
            }
        }

        if (e.type === 'text') {
            this.#input =
                this.#input.slice(0, this.#cursor) +
                e.value +
                this.#input.slice(this.#cursor)

            this.#cursor++
            this.#renderInput()
        }
    }

    log(obj: any) {
        const rows = process.stdout.rows || 24

        // limpiar input temporalmente
        readline.cursorTo(process.stdout, 0, rows - 1)
        readline.clearLine(process.stdout, 0)

        this.#logs.push(stripAnsi(`${obj}`))
        if (this.#logs.length > 200) this.#logs.shift()

        const maxOffset = Math.max(0, this.#logs.length - 1)

        if (this.#isUserScrolling) {
            // 🔥 mantener viewport fijo
            this.#scrollOffset++
        } else {
            // 🔥 auto-scroll normal
            this.#scrollOffset = 0
        }

        this.#scrollOffset = Math.min(this.#scrollOffset, maxOffset)

        this.render()
    }

    #fixedInfo() {
        const maxScroll = Math.max(1, this.#logs.length)
        const percent = Math.round((1 - this.#scrollOffset / maxScroll) * 100)

        return [
            `Scroll: ${percent}% ${this.#isUserScrolling ? '[SCROLL]' : '[LIVE]'}`,
            `current process: ${this.#currentProcess}`,
            `mouse: ${this.#mouseEnabled ? 'enabled' : 'disabled'} (ctrl+b to toggle)`,
        ]
    }

    render() {
        const rows = process.stdout.rows || 24
        const cols = process.stdout.columns || 80

        const inputHeight = 1
        const statusHeight = 3
        const logHeight = rows - inputHeight - statusHeight - 2

        readline.cursorTo(process.stdout, 0, 0)
        readline.clearScreenDown(process.stdout)

        const start = Math.max(
            0,
            this.#logs.length - logHeight - this.#scrollOffset,
        )

        const end = start + logHeight

        const visibleLogs = this.#logs.slice(start, end)

        for (const log of visibleLogs) {
            process.stdout.write(log + '\n')
        }

        process.stdout.write('─'.repeat(cols) + '\n')

        const info = this.#fixedInfo()
        for (const line of info) {
            process.stdout.write(line + '\n')
        }

        process.stdout.write('─'.repeat(cols) + '\n')

        this.#renderInput()
    }

    #renderInput() {
        const rows = process.stdout.rows || 24

        // ir a la línea del input
        readline.cursorTo(process.stdout, 0, rows - 1)
        readline.clearLine(process.stdout, 0)

        process.stdout.write(`> ${this.#input}`)

        // mover cursor a su posición real
        readline.cursorTo(process.stdout, 2 + this.#cursor, rows - 1)
    }

    destroy() {
        process.stdout.write('\x1b[?1000l')
        process.stdout.write('\x1b[?1006l')
        process.stdout.write('\x1b[?1002l')

        process.stdin.setRawMode(false)
        process.stdin.pause()
    }
}

const ui = new ConsoleUI()

ui.onCommand = cmd => {
    let count = 5
    const inter = setInterval(() => {
        ui.log(`${count--}`)
    }, 1_000)

    setTimeout(() => clearInterval(inter), 6_000)

    ui.log(`Ejecutaste: ${cmd}`)
}
