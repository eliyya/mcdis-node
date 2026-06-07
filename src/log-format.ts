const ansiPattern = /\u001b\[[0-9;]*m/gu

export function cleanConsoleLog(input: string): string {
	return input.replace(ansiPattern, '').replaceAll('`', "'").replaceAll('\r', '').trimEnd()
}

export function formatManagerLog(message: string, type = 'INFO'): string {
	const time = new Intl.DateTimeFormat('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	}).format(new Date())

	return `[McDis] [${time}] [MainThread/${type}]: ${message}`
}

export function shouldRelayLog(log: string, blacklist: string[]): boolean {
	const trimmed = log.replaceAll('\n', '').trim()
	if (!trimmed) {
		return false
	}

	return !blacklist.some((term) => term.length > 0 && log.includes(term))
}
