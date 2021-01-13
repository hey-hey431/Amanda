class AsyncValueCache<T> {
	public getter: () => Promise<T>
	public lifetime?: number
	public lifetimeTimeout: NodeJS.Timeout | null
	public promise: Promise<T> | null
	public cache: T | null

	constructor(getter: () => Promise<T>, lifetime: number | undefined = undefined) {
		this.getter = getter
		this.lifetime = lifetime
		this.lifetimeTimeout = null
		this.promise = null
		this.cache = null
	}

	clear() {
		if (this.lifetimeTimeout) clearTimeout(this.lifetimeTimeout)
		this.cache = null
	}

	get() {
		if (this.cache) return Promise.resolve(this.cache)
		if (this.promise) return this.promise
		return this._getNew()
	}

	async _getNew() {
		this.promise = this.getter()
		const result = await this.promise
		this.cache = result
		this.promise = null
		if (this.lifetimeTimeout) clearTimeout(this.lifetimeTimeout)
		if (this.lifetime) this.lifetimeTimeout = setTimeout(() => this.clear(), this.lifetime)
		return result
	}
}

export = AsyncValueCache
