/**
 * @typedef {Object} PassthroughType
 * @property {Object} config
 * @property {String} config.bot_token
 * @property {String} config.fake_token
 * @property {String} config.mysql_password
 * @property {String} config.yt_api_key
 * @property {String} config.chewey_api_key
 * @property {String} config.website_protocol
 * @property {String} config.website_domain
 * @property {Boolean} config.is_staging
 * @property {import("discord.js").Client} client
 * @property {import("./commandstore")} commands
 * @property {import("mysql2/promise").PromisePool} db
 * @property {import("./hotreload")} reloader
 * @property {import("events").EventEmitter} reloadEvent
 * @property {Object} queueManager
 * @property {import("discord.js").Collection<import("discord.js").Snowflake, any>} queueManager.storage <guildID, queue>
 * @property {Number} queueManager.songsPlayed
 * @property {Function} queueManager.addQueue
 * @property {import("events").EventEmitter} queueManager.events
 * @property {Object} gameManager
 * @property {import("discord.js").Collection<import("discord.js").Snowflake, any>} gameManager.storage
 * @property {Number} gameManager.gamesPlayed
 * @property {Function} gameManager.addGame
 * @property {import("simple-youtube-api")} youtube
 * @property {import("ws").Server} wss
 */