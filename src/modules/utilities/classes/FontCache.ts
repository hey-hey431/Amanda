import BitmapCache from "./BitmapCache"

class FontCache extends BitmapCache<import("@jimp/plugin-print").Font> {
	public type: "font" = "font"

	constructor() {
		super("font")
	}
}

export = FontCache
