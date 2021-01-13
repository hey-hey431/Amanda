class BetterTimeout {
	public callback: ((...params: Array<any>) => any) | null
	public delay: number | null
	public isActive: boolean
	public timeout: NodeJS.Timeout | null

	constructor() {
		this.callback = null
		this.delay = null
		this.isActive = false
		this.timeout = null
	}

	setCallback(callback: (...params: Array<any>) => any) {
		this.clear()
		this.callback = callback
		return this
	}

	setDelay(delay: number) {
		this.clear()
		this.delay = delay
		return this
	}
	run() {
		this.clear()
		if (this.callback && this.delay) {
			const cb = this.callback
			this.isActive = true
			this.timeout = setTimeout(() => cb(), this.delay)
		}
	}
	triggerNow() {
		this.clear()
		if (this.callback) this.callback()
	}
	clear() {
		this.isActive = false
		if (this.timeout) clearTimeout(this.timeout)
	}
}

export = BetterTimeout
