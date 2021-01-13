class SingleUseMap<K, V> extends Map<K, V> {
	constructor() {
		super()
	}

	use(key: K): V | undefined {
		const value = this.get(key)
		this.delete(key)
		return value
	}
}

export = SingleUseMap
