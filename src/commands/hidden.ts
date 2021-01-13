const Discord: typeof import("thunderstorm") = require("thunderstorm")

import passthrough from "../passthrough"
const { commands, client, constants, reloader } = passthrough

import utils from "../modules/utilities"
reloader.sync("./modules/utilities/index.js", utils)

commands.assign([
	{
		usage: "None",
		description: "same energy as https://cdn.discordapp.com/attachments/649351366736740352/768063300566122516/unknown.png",
		aliases: ["sit"],
		category: "hidden",
		examples: ["amanda, sit"],
		async process(msg) {
			if (!msg.content.startsWith(`${client.user!.username.toLowerCase()}, `)) return
			const embed = new Discord.MessageEmbed()
				.setColor(constants.standard_embed_color)
				.setImage("https://cdn.discordapp.com/attachments/608456955660468224/777735506703810560/chibiv3.png")
			return msg.channel.send(await utils.contentify(msg.channel, embed))
		}
	}
])
