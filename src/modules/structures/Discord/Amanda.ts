// @ts-check

const Discord: typeof import("thunderstorm") = require("thunderstorm")
import Lavalink from "lavacord"
import RainCache from "raincache"

import passthrough from "../../../passthrough"
import config from "../../../../config"

const AmpqpConnector = RainCache.Connectors.AmqpConnector
const RedisStorageEngine = RainCache.Engines.RedisStorageEngine
const MemoryStorageEngine = RainCache.Engines.MemoryStorageEngine

const connection = new AmpqpConnector({
	amqpUrl: `amqp://${config.amqp_username}:${config.redis_password}@${config.amqp_origin}:${config.amqp_port}/amanda-vhost`
})
const mem = new MemoryStorageEngine()
const rain = new RainCache({
	storage: {
		default: new RedisStorageEngine({
			redisOptions: {
				host: config.amqp_origin,
				password: config.redis_password
			}
		}),
		// @ts-ignore
		guild: mem,
		// @ts-ignore
		voiceState: mem
	},
	structureDefs: {
		guild: {
			whitelist: ["channels", "icon", "id", "joined_at", "member_count", "name", "owner_id", "preferred_locale", "region", "roles", "unavailable", "voice_states"]
		},
		voiceState: {
			whitelist: ["channel_id", "guild_id", "member", "session_id", "user_id"]
		}
	},
	debug: false
}, connection, connection)

class Amanda extends Discord.Client {
	public lavalink: Lavalink.Manager
	public rain: RainCache<any, any>
	/**
	 * Do not use this.
	 */
	private passthrough: typeof passthrough

	constructor(options: import("thunderstorm").ClientOptions) {
		super(options)
		// @ts-ignore
		this.lavalink = undefined
		this.passthrough = passthrough

		this.rain = rain
	}
}

export = Amanda
