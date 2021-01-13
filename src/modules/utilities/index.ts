import path from "path"

import passthrough from "../../passthrough"
const { reloader } = passthrough

import { addTemporaryListener } from "./eventutils"

const loadBlacklist = [".test.js", "index.js"]

import fs from "fs"
for (const file of [...fs.readdirSync(__dirname), ...fs.readdirSync(`${__dirname}/classes`)].filter(f => f.endsWith(".js") && !loadBlacklist.find(entry => f.endsWith(entry)))) {
	addTemporaryListener(reloader.reloadEvent, file, path.basename(__filename), () => {
		setImmediate(() => { // event is emitted synchronously before decache, so wait for next event loop
			reloader.resync("./modules/utilities/index.js")
		})
	}, "once")
}

import { random as arrayRandom, shuffle as arrayShuffle } from "./arrayutils"
import AsyncValueCache from "./classes/AsyncValueCache"
import BetterTimeout from "./classes/BetterTimeout"
import BitmapCache from "./classes/BitmapCache"
import ImageCache from "./classes/ImageCache"
import FontCache from "./classes/FontCache"

import jimpStores from "./jimpstores"
import cacheManager from "./cachemanager"
import coinsManager from "./coinsmanager"
import discordutils from "./discordutils"
import eventutils from "./eventutils"
import langutils from "./langutils"
import pagination from "./pagination"
import shardinfo from "./shardinfo"
import editLavalinkNodes from "./lavalinkutils"
import sql from "./sql"
import text from "./text"
import time from "./time"

export = {
	arrayRandom,
	arrayShuffle,
	AsyncValueCache,
	BetterTimeout,
	BitmapCache,
	ImageCache,
	FontCache,
	jimpStores,
	...cacheManager,
	coinsManager: coinsManager,
	...discordutils,
	...eventutils,
	...langutils,
	...pagination,
	...shardinfo,
	editLavalinkNodes,
	sql,
	...text,
	...time
}
