export type InputEvent =
    | { type: 'text'; value: string }
    | { type: 'key'; name: string }
    | { type: 'mouse'; action: 'scrollUp' | 'scrollDown' }

export class TerminalParser {
    #buffer = ''

    parse(data: string): InputEvent[] {
        this.#buffer += data
        const events: InputEvent[] = []

        while (this.#buffer.length) {
            // 🖱 mouse (SGR)
            const mouseMatch = this.#buffer.match(
                /^\x1b\[<(\d+);(\d+);(\d+)([mM])/,
            )
            if (mouseMatch) {
                const [full, code] = mouseMatch
                const c = Number(code)

                if (c === 64) {
                    events.push({ type: 'mouse', action: 'scrollUp' })
                } else if (c === 65) {
                    events.push({ type: 'mouse', action: 'scrollDown' })
                }

                this.#buffer = this.#buffer.slice(full.length)
                continue
            }

            // ⌨️ flechas
            if (this.#buffer.startsWith('\x1b[A')) {
                events.push({ type: 'key', name: 'up' })
                this.#buffer = this.#buffer.slice(3)
                continue
            }

            if (this.#buffer.startsWith('\x1b[B')) {
                events.push({ type: 'key', name: 'down' })
                this.#buffer = this.#buffer.slice(3)
                continue
            }

            if (this.#buffer.startsWith('\x1b[C')) {
                events.push({ type: 'key', name: 'right' })
                this.#buffer = this.#buffer.slice(3)
                continue
            }

            if (this.#buffer.startsWith('\x1b[D')) {
                events.push({ type: 'key', name: 'left' })
                this.#buffer = this.#buffer.slice(3)
                continue
            }

            // PageUp / PageDown
            if (this.#buffer.startsWith('\x1b[5~')) {
                events.push({ type: 'key', name: 'pageup' })
                this.#buffer = this.#buffer.slice(4)
                continue
            }

            if (this.#buffer.startsWith('\x1b[6~')) {
                events.push({ type: 'key', name: 'pagedown' })
                this.#buffer = this.#buffer.slice(4)
                continue
            }

            // Enter
            if (this.#buffer.startsWith('\r')) {
                events.push({ type: 'key', name: 'return' })
                this.#buffer = this.#buffer.slice(1)
                continue
            }

            // Ctrl+C
            if (this.#buffer.startsWith('\x03')) {
                events.push({ type: 'key', name: 'ctrl+c' })
                this.#buffer = this.#buffer.slice(1)
                continue
            }

            // Backspace
            if (this.#buffer.startsWith('\x7f')) {
                events.push({ type: 'key', name: 'backspace' })
                this.#buffer = this.#buffer.slice(1)
                continue
            }

            // texto normal
            const char = this.#buffer[0]!
            events.push({ type: 'text', value: char })
            this.#buffer = this.#buffer.slice(1)
        }

        return events
    }
}
