import Jimp from "jimp"

class BitmapCache<T extends (import("jimp") | import("@jimp/plugin-print").Font)> {
	public type: "image" | "font"
	public store: Map<string, string>

	constructor(type: "image" | "font") {
		this.type = type
		this.store = new Map()
	}

	save(name: string, dir: string) {
		this.store.set(name, dir)
	}

	async get(name: string): Promise<T | null> {
		const dir = this.store.get(name)
		if (!dir) return null
		let value
		if (this.type == "image") {
			value = await Jimp.read(dir)
		} else if (this.type == "font") {
			value = await Jimp.loadFont(dir)
		}
		if (!value) return null
		// @ts-ignore
		return value
	}

	async getAll(names: Array<string>): Promise<Map<string, T>> {
		const result = new Map()
		await Promise.all(names.map(name => this.get(name).then(value => result.set(name, value))))
		return result
	}
}

export = BitmapCache
