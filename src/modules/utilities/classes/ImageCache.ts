import BitmapCache from "./BitmapCache"

class ImageCache extends BitmapCache<import("jimp")> {
	public type: "image" = "image"

	constructor() {
		super("image")
	}
}

export = ImageCache
