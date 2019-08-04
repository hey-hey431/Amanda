const Discord = require("discord.js");
const mysql = require("mysql2/promise");
const hotreload = require("./hotreload.js");
const commandstore = require("./commandstore.js");
const YouTube = require("simple-youtube-api");

const config = require("./config.json");
const client = new Discord.Client({disableEveryone: true});
const youtube = new YouTube(config.yt_api_key);

let db = mysql.createPool({
	host: config.mysql_domain,
	user: "amanda",
	password: config.mysql_password,
	database: "money",
	connectionLimit: 5
});

let commands = new commandstore();
let reactionMenus = {};

let queueManager = {
	storage: new Discord.Collection(),
	songsPlayed: 0,
	addQueue(queue) {
		this.storage.set(queue.id, queue);
	}
};
let gameManager = {
	storage: new Discord.Collection(),
	gamesPlayed: 0,
	addGame: function(game) {
		this.storage.set(game.id, game);
	}
};

(async () => {
	await Promise.all([
		db.query("SET NAMES 'utf8mb4'"),
		db.query("SET CHARACTER SET utf8mb4")
	]);

	let reloader = new hotreload();
	let passthrough = {config, client, commands, db, reloader, reloadEvent: reloader.reloadEvent, reactionMenus, queueManager, gameManager, youtube};
	reloader.setPassthrough(passthrough);
	reloader.setupWatch([
		"./modules/utilities.js",
		"./modules/validator.js",
		"./commands/music/common.js",
		"./commands/music/songtypes.js",
		"./commands/music/queue.js",
		"./commands/music/playlistcommand.js"
	])
	reloader.watchAndLoad([
		"./modules/prototypes.js",
		"./modules/events.js",
		"./modules/stdin.js",
		"./modules/lang.js",
		"./commands/admin.js",
		"./commands/cleverai.js",
		"./commands/gambling.js",
		"./commands/games.js",
		"./commands/images.js",
		"./commands/interaction.js",
		"./commands/meta.js",
		"./commands/music/music.js",
		"./commands/traa.js",
		"./commands/web/server.js"
	])
	
	// no reloading for statuses. statuses will be periodically fetched from mysql.
	require("./modules/status.js")(passthrough)

	client.login(config.bot_token);

})();
