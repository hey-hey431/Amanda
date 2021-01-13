import Discord from "thunderstorm"

class StreakManager {
	public cache: Discord.Collection<string, { ID: string, command: string, amount: number, timeout?: NodeJS.Timeout }>
	public destructionDurations: Map<string, number>

	public constructor() {
		this.cache = new Discord.Collection()
		this.destructionDurations = new Map()
	}

	/**
	 * For `info.maxMultiplier`: Mutiply the max by this number to get a "new max" to clamp to.
	 *
	 * For `info.multiplierStep`: How much more should be added to the original calculated amount multiplied by how many steps it took to get to the clamped max. (original + (stepsTaken * info.multiplierStep))
	 *
	 * For `info.absoluteMax`: The ABSOLUTE max amount `info.maxMultiplier` can clamp to
	 */
	public calculate(info: { max: number, step: number, command: string, userID: string, maxMultiplier?: number, multiplierStep?: number, absoluteMax?: number }, increment = false) {
		const data = this.cache.get(`${info.userID}-${info.command}`)
		if (!data) return this.create(info.userID, info.command)
		if (increment) this.increment(info.userID, info.command)
		const original = info.step * (data.amount >= info.max ? info.max : data.amount)
		if (info.maxMultiplier && info.multiplierStep && data.amount >= (info.max * info.maxMultiplier)) {
			const v = info.absoluteMax ? info.absoluteMax : data.amount
			return original + (Math.floor(Math.log10(v)) * info.multiplierStep) - info.multiplierStep
		} else return original
	}

	public create(userID: string, command: string) {
		const timeout = this.getDestroyDuration(command)
		const pl = {
			ID: userID,
			command,
			amount: 0
		}
		if (timeout) Object.assign(pl, { timeout: setTimeout(() => this.delete(userID, command), timeout) })
		this.cache.set(`${userID}-${command}`, pl)
		return 0
	}

	public getStreak(userID: string, command: string) {
		const data = this.cache.get(`${userID}-${command}`)
		if (!data) return this.create(userID, command)
		else return data.amount
	}

	/**
	 * Increments a streak amount for a command. returns 0 if no data and the incremented amount on success
	 */
	public increment(userID: string, command: string) {
		const data = this.cache.get(`${userID}-${command}`)
		if (!data) return this.create(userID, command)
		data.amount++
		if (data.timeout) {
			const timeout = this.getDestroyDuration(command)
			clearTimeout(data.timeout)
			if (timeout) data.timeout = setTimeout(() => this.delete(userID, command), timeout)
		}
		return data.amount + 1
	}

	public delete(userID: string, command: string) {
		return this.cache.delete(`${userID}-${command}`)
	}

	/**
	 * @param duration The duration in ms (0 for no destruction). Defaults to 0
	 */
	public setDestroyDuration(command: string, duration = 0) {
		this.destructionDurations.set(command, duration)
	}

	public getDestroyDuration(command: string) {
		return this.destructionDurations.get(command) || 0
	}
}

export = StreakManager
