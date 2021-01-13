// @ts-check

import mysql from "mysql2/promise"
// @ts-ignore
import YouTube from "simple-youtube-api"
import nedb from "nedb-promises"
// @ts-ignore
import Frisky from "frisky-client"
import WeebSH from "taihou"
import Reloader from "@amanda/reloader"
import fs from "fs"
import path from "path"
import events from "events"
import SnowTransfer from "snowtransfer"
const ThunderStorm: typeof import("thunderstorm") = require("thunderstorm")
import workers from "worker_threads"
import ListenMoe from "listensomemoe"

import CommandManager from "@amanda/commandmanager"

import passthrough from "./passthrough"
import Amanda from "./modules/structures/Discord/Amanda"
import config from "../config"
import constants from "./constants.js"

const GatewayWorker = new workers.Worker(path.join(__dirname, "../../workers/gateway.js"))
const rest = new SnowTransfer(config.bot_token, { disableEveryone: true, baseHost: `${config.rest_server_protocol}://${config.rest_server_domain}` })
const client = new Amanda({ snowtransfer: rest, disableEveryone: true })
const youtube = new YouTube(config.yt_api_key)
const reloader = new Reloader(true, __dirname)
const listenMoeJP = new ListenMoe(ListenMoe.Constants.baseJPOPGatewayURL)
const listenMoeKP = new ListenMoe(ListenMoe.Constants.baseKPOPGatewayURL)
const weeb = new WeebSH(config.weeb_api_key, true, { userAgent: config.weeb_identifier, timeout: 20000, baseURL: "https://api.weeb.sh" })
// @ts-ignore
const internalEvents: import("./typings/index").internalEvents = new events.EventEmitter()

reloader.reloadEvent.setMaxListeners(20)

const db = mysql.createPool({
	host: config.mysql_domain,
	user: "amanda",
	password: config.mysql_password,
	database: "money",
	connectionLimit: 5
});

(async () => {
	// DB

	await Promise.all([
		db.query("SET NAMES 'utf8mb4'"),
		db.query("SET CHARACTER SET utf8mb4"),
		client.rain.initialize()
	])

	Object.assign(passthrough, { config, constants, client, db, reloader, youtube, reloadEvent: reloader.reloadEvent, internalEvents, frisky: new Frisky(), weeb, listenMoe: { jp: listenMoeJP, kp: listenMoeKP } })

	const CacheRequester: typeof import("./modules/managers/CacheRequester") = require("./modules/managers/CacheRequester")
	const GatewayRequester: typeof import("./modules/managers/GatewayRequester") = require("./modules/managers/GatewayRequester")
	const cache = new CacheRequester()
	const gateway = new GatewayRequester(GatewayWorker)
	passthrough.workers = { cache, gateway }

	GatewayWorker.on("message", (message) => {
		const { op, data, threadID } = message
		if (op === "DISCORD") {
			client.rain.eventProcessor.inbound(data)
			return ThunderStorm.handle(message.data, client)
		} else {
			if (op === "ERROR_RESPONSE") return console.error(data)
			if (gateway.outgoing.has(threadID)) {
				gateway.outgoing.use(threadID)(data)
			} else console.log(`Not a thread:\n${message}`)
		}
	})

	listenMoeJP.on("error", console.error)
	listenMoeKP.on("error", console.error)
	listenMoeJP.on("unknown", console.log)
	listenMoeKP.on("unknown", console.log)

	// Utility files

	reloader.watch([
		...fs.readdirSync(`${__dirname}/modules/utilities`).filter(f => f.endsWith(".js")).map(f => `./modules/utilities/${f}`),
		...fs.readdirSync(`${__dirname}/modules/utilities/classes`).filter(f => f.endsWith(".js")).map(f => `./modules/utilities/classes/${f}`)
	])

	// IPC

	const IPC: typeof import("./modules/ipc/ipcbot") = require("./modules/ipc/ipcbot")
	const ipc = new IPC()
	passthrough.ipc = ipc

	reloader.watchAndLoad([
		"./modules/ipc/ipcbotreplier.js"
	])
	reloader.watch([
		"./modules/ipc/ipcreplier.js"
	])

	// Music parts

	reloader.watch([
		"./commands/music/common.js",
		"./commands/music/playlistcommand.js",
		"./commands/music/queue.js",
		"./commands/music/songtypes.js"
	])

	// Passthrough managers

	const GameManager: typeof import("./modules/managers/GameManager") = require("./modules/managers/GameManager")
	const QueueManager: typeof import("./modules/managers/QueueManager") = require("./modules/managers/QueueManager")
	const StreakManager: typeof import("./modules/managers/StreakManager") = require("./modules/managers/StreakManager")
	const PeriodicHistory: typeof import("./modules/structures/PeriodicHistory") = require("./modules/structures/PeriodicHistory")

	passthrough.commands = new CommandManager()
	passthrough.games = new GameManager()
	passthrough.queues = new QueueManager()
	passthrough.streaks = new StreakManager()
	passthrough.periodicHistory = new PeriodicHistory([
		{ field: "song_start", ttl: 86400e3 },
		{ field: "game_start", ttl: 86400e3 }
	])
	passthrough.nedb = {
		queue: nedb.create({ filename: `saves/queue-${config.cluster_id}.db`, autoload: true })
	}
	internalEvents.emit("QueueManager", passthrough.queues)

	// Can't be part of reloader, and depends on IPC, so it's down here.

	reloader.watchAndLoad([
		"./modules/reloadapi.js"
	])

	// Commands

	reloader.watchAndLoad([
		"./commands/music/music.js",
		"./commands/music/playlistcommand.js",
		"./commands/admin.js",
		"./commands/couples.js",
		"./commands/gambling.js",
		"./commands/games.js",
		"./commands/hidden.js",
		"./commands/images.js",
		"./commands/interaction.js",
		"./commands/meta.js",
		"./commands/webhookalias.js",
		"./modules/events.js",
		"./modules/stdin.js"
	])

	// no reloading for statuses. statuses will be periodically fetched from mysql.
	require("./commands/status.js")
})()
