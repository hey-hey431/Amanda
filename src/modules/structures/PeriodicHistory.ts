import utils from "../utilities"

class Queue {
	public ttl: number
	public items: Array<number>

	constructor(ttl: number) {
		this.ttl = ttl
		this.items = []
	}

	/**
	 * Add to the queue. (Doesn't affect database.)
	 */
	add(timestamp?: number) {
		if (!timestamp) timestamp = Date.now()
		else if (Date.now() - timestamp > this.ttl) return
		this.items.push(timestamp)
	}

	sweep() {
		const currentTime = Date.now()
		const oldLength = this.items.length
		this.items = this.items.filter(i => currentTime - i < this.ttl)
		return oldLength - this.items.length
	}

	size() {
		this.sweep()
		return this.items.length
	}
}

class PeriodicHistory {
	public defaultTtl: number
	public store: Map<string, Queue>
	public fetching: boolean
	public fetch: import("../utilities/classes/AsyncValueCache")<Array<import("mysql2/promise").RowDataPacket>>

	constructor(fields: Array<{ field: string; ttl: number }>, defaultTtl = 86400000) {
		this.defaultTtl = defaultTtl

		this.store = new Map()
		this.fetching = true

		fields.forEach(field => {
			this.store.set(field.field, new Queue(field.ttl))
		})

		this.fetch = new utils.AsyncValueCache(async () => {
			const rows = await utils.sql.all("SELECT field, timestamp FROM PeriodicHistory")
			// TODO: also sweep the database
			rows.forEach(row => {
				const queue = this.getOrCreate(row.field)
				queue.add(row.timestamp)
			})
			this.fetching = false
			this.sweep(true)
			return rows
		})
		this.fetch.get()

		// Periodically sweep out old entries
		setInterval(() => {
			this.sweep()
		}, 300e3) // 5 minutes
	}

	/**
	 * Add to the queue and send to the database.
	 */
	add(field: string, timestamp?: number) {
		const queue = this.getOrCreate(field)
		queue.add(timestamp)
		return utils.sql.all("insert into PeriodicHistory (field, timestamp) values (?, ?)", [field, Date.now()])
	}

	getOrCreate(field: string) {
		const existing = this.store.get(field)
		if (existing) return existing
		else {
			console.error(`Creating a new PeriodicHistory/${field}! You probably don't want to do this.`)
			const queue = new Queue(this.defaultTtl)
			this.store.set(field, queue)
			return queue
		}
	}

	getSize(field: string) {
		return this.getOrCreate(field).size()
	}

	/**
	 * Sweep each queue, and if items were removed, also delete from the database.
	 */
	sweep(force = false) {
		for (const field of this.store.keys()) {
			const queue = this.getOrCreate(field)
			const removed = queue.sweep()
			if (removed || force) utils.sql.all("DELETE FROM PeriodicHistory WHERE field = ? AND timestamp < ?", [field, Date.now() - queue.ttl])
		}
	}
}

export = PeriodicHistory
