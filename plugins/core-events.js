module.exports = function(passthrough) {
	let { Discord, client, reloadEvent, utils, commands } = passthrough;
	const Auth = process.env.is_heroku ? JSON.parse(process.env.auth) : require("../auth.json", "utf8");
	const stdin = process.stdin;
	let prefixes = [];
	let statusPrefix = "&";

	if (Auth.dbl_key) {
		const dbl = require("dblapi.js");
		const poster = new dbl(Auth.dbl_key, client);
		poster.once("posted", () => console.log("Server count posted"));
		poster.on("error", reason => console.error(reason));
		reloadEvent.once(__filename, () => {
			poster.removeListener("error");
		});
	} else {
		console.log("No DBL API key. Server count posting is disabled.");
	}

	client.on("message", manageMessage);
	client.on("messageUpdate", manageEdit);
	client.on("ready", manageReady);
	client.on("disconnect", manageDisconnect);
	client.on("error", manageError);
	client.on("warn", manageWarn);
	process.on("unhandledRejection", manageRejection);
	stdin.on("data", manageStdin);
	reloadEvent.once(__filename, () => {
		client.removeListener("message", manageMessage);
		client.removeListener("messageUpdate", manageEdit);
		client.removeListener("ready", manageReady);
		client.removeListener("disconnect", manageDisconnect);
		client.removeListener("error", manageError);
		client.removeListener("warn", manageWarn);
		process.removeListener("unhandledRejection", manageRejection);
		stdin.removeListener("data", manageStdin);
	});

	async function manageStdin(input) {
		input = input.toString();
		try {
			console.log(await utils.stringify(eval(input)));
		} catch (e) {
			console.log(e.stack);
		}
	}

	function manageMessage(msg) {
		checkMessageForCommand(msg, false);
	}

	function manageEdit(oldMessage, newMessage) {
		if (newMessage.editedTimestamp && oldMessage.editedTimestamp != newMessage.editedTimestamp) checkMessageForCommand(newMessage, true);
	}

	function manageReady() {
		console.log("Successfully logged in as "+client.user.username);
		utils.sql("SELECT * FROM AccountPrefixes WHERE userID = ?", [client.user.id]).then(result => {
			prefixes = result.map(r => r.prefix);
			statusPrefix = result.find(r => r.status).prefix;
			console.log("Loaded "+prefixes.length+" prefixes");
			update();
			client.setInterval(update, 300000);
		});
	}

	function manageDisconnect(reason) {
		console.log(`Disconnected with ${reason.code} at ${reason.path}\n\nReconnecting in 6sec`);
		setTimeout(() => client.login(Auth.bot_token), 6000);
	}

	function manageError(reason) {
		console.error(reason);
	}

	function manageWarn(reason) {
		console.error(reason);
	}

	function manageRejection(reason) {
		if (reason.code == 10008) return;
		if (reason.code == 50013) return;
		console.error(reason);
	}

	const presences = [
		['alone', 'PLAYING'], ['in a box', 'PLAYING'], ['with fire', 'PLAYING'],
		['anime', 'WATCHING'], ['Netflix', 'WATCHING'], ['YouTube', 'WATCHING'], ['bots take over the world', 'WATCHING'], ['endless space go by', 'WATCHING'],
		['music', 'LISTENING'], ['Spootify', 'LISTENING'],
		['with Shodan', 'STREAMING'],
	];
	const update = () => {
		const [name, type] = presences[Math.floor(Math.random() * presences.length)];
		client.user.setActivity(`${name} | ${statusPrefix}help`, { type, url: 'https://www.twitch.tv/papiophidian/' });
	};

	async function checkMessageForCommand(msg, isEdit) {
		if (msg.author.bot) return;
		var prefix = prefixes.find(p => msg.content.startsWith(p));
		if (!prefix) return;
		var cmdTxt = msg.content.substring(prefix.length).split(" ")[0];
		var suffix = msg.content.substring(cmdTxt.length + prefix.length + 1);
		var cmd = Object.values(commands).find(c => c.aliases.includes(cmdTxt));
		if (cmd) {
			try {
				await cmd.process(msg, suffix, isEdit);
			} catch (e) {
				var msgTxt = `command ${cmdTxt} failed <:rip:401656884525793291>\n`+(await utils.stringify(e));
				const embed = new Discord.RichEmbed()
				.setDescription(msgTxt)
				.setColor("B60000")
				msg.channel.send({embed});
			}
		} else return;
	};

	return {};
}