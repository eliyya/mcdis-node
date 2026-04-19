export function splitTextByLimit(
    text: string,
    max = 1024,
): {
    chunk: string
    rest: string
} {
    let total = 0
    const lines = text.split(/\r?\n/)

    const taken: string[] = []
    let index = 0

    for (; index < lines.length; index++) {
        const line = lines[index]!
        const length = line.length + 1

        if (total + length > max) {
            break
        }

        total += length
        taken.push(line)
    }

    return {
        chunk: taken.join('\n'),
        rest: lines.slice(index).join('\n'),
    }
}