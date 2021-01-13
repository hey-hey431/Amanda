import passthrough from "../../passthrough"
const { client } = passthrough

export async function getOwnStats() {
	const ram = process.memoryUsage()
	return {
		uptime: process.uptime(),
		ram: ram.rss - (ram.heapTotal - ram.heapUsed),
		users: await client.rain.cache.user.getIndexCount(),
		guilds: await client.rain.cache.guild.getIndexCount(),
		channels: await client.rain.cache.channel.getIndexCount(),
		connections: client.lavalink.players.size
	}
}

export default { getOwnStats }
