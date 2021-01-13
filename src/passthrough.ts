// @ts-ignore
if (process._ptcreated) throw new Error("Do not reload the passthrough file.")
// @ts-ignore
process._ptcreated = true

interface Passthrough {
	client: import("./modules/structures/Discord/Amanda")
	config: typeof import("../config")
	constants: typeof import("./constants")
	commands: import("@amanda/commandmanager")<[import("thunderstorm").Message, string, import("@amanda/lang").Lang]>
	db: import("mysql2/promise").Pool
	reloader: import("@amanda/reloader")
	reloadEvent: import("events").EventEmitter
	internalEvents: import("./typings/index").internalEvents
	games: import("./modules/managers/GameManager")
	queues: import("./modules/managers/QueueManager")
	streaks: import("./modules/managers/StreakManager")
	periodicHistory: import("./modules/structures/PeriodicHistory")
	// @ts-ignore
	youtube: import("simple-youtube-api")
	wss: import("ws").Server
	nedb: {
		[key: string]: import("nedb-promises")
	}
	// @ts-ignore
	frisky: import("frisky-client")
	ipc: import("./modules/ipc/ipcbot")
	weeb: import("taihou")
	statusPrefix: string
	rain: Passthrough["client"]["rain"]
	workers: {
		cache: import("./modules/managers/CacheRequester")
		gateway: import("./modules/managers/GatewayRequester")
	}
	listenMoe: {
		jp: import("listensomemoe")
		kp: import("listensomemoe")
	}
}

export = {} as Passthrough
