const Discord: typeof import("thunderstorm") = require("thunderstorm")
import path from "path"
// @ts-ignore
import mixinDeep from "mixin-deep"

import passthrough from "../../passthrough"
const { config, constants, client, reloader, ipc } = passthrough

import utils from "../utilities"
reloader.sync("./modules/utilities/index.js", utils)

import Replier from "./ipcreplier"
utils.addTemporaryListener(reloader.reloadEvent, "ipcreplier.js", path.basename(__filename), () => {
	setImmediate(() => { // event is emitted synchronously before decache, so wait for next event loop
		reloader.resync("./modules/ipc/ipcbotreplier.js")
	})
}, "once")

function filterGuild(guild: import("thunderstorm").Guild): import("../../typings/index").FilteredGuild {
	return {
		id: guild.id,
		name: guild.name,
		icon: guild.icon!,
		nameAcronym: guild.name.split(" ").map(it => it[0].toUpperCase()).join("")
	}
}

function getQueue(guildID: string) {
	const queueStore = passthrough.queues
	if (!queueStore) return null
	const queue = queueStore.cache.get(guildID)
	if (!queue) return null
	return queue
}

/**
 * - RECEIVE
 * - REPLY
 * - REQUEST
 * - SEND
 */
class ClientReplier extends Replier {
	public ipc: import("./ipcbot")

	constructor() {
		super()
		this.ipc = ipc
	}

	onMessage(raw: { op: string, data: any, threadID: string }) {
		this.baseOnMessage(raw, rawReply => this.ipc.send(rawReply))
	}

	request(op: string, data?: any) {
		return this.baseRequest(op, data, raw => {
			this.ipc.send(raw)
		})
	}

	async REPLY_GET_GUILD(guildID: string) {
		// @ts-ignore
		const guild: Discord.Guild = await utils.cacheManager.guilds.get(guildID, true, false)
		if (guild) return filterGuild(guild)
		else return null
	}

	async REPLY_GET_DASH_GUILDS(input: { userID: string, np: boolean }) {
		const { userID, np } = input
		const manager = passthrough.queues
		const guilds = []
		const npguilds = []
		const gs = []
		for (const id of await client.rain.cache.guild.getIndexMembers()) {
			const result = await client.rain.cache.member.isIndexed(userID, id)
			if (result) gs.push(id)
		}
		for (const guild of gs) {
			let isNowPlaying = false
			if (np) {
				if (manager && manager.cache.has(guild)) isNowPlaying = true
				if (await client.rain.cache.voiceState.get(userID, guild)) isNowPlaying = true
			}
			const g = await utils.cacheManager.guilds.get(guild, true, true)
			// @ts-ignore
			if (isNowPlaying) npguilds.push(filterGuild(g))
			// @ts-ignore
			else guilds.push(filterGuild(g))
		}
		return { guilds, npguilds }
	}

	async REPLY_GET_GUILD_FOR_USER(input: { userID: string, guildID: string }) {
		const { guildID, userID } = input
		const guild = await utils.cacheManager.guilds.get(guildID, true, true)
		if (!guild) return null
		const member = await client.rain.cache.member.isIndexed(userID, guildID)
		if (!member) return null
		// @ts-ignore
		return filterGuild(guild)
	}

	REPLY_GET_QUEUE_STATE(guildID: string) {
		const queue = getQueue(guildID)
		if (!queue) return null
		const state = queue.wrapper.getState()
		return state
	}

	REPLY_TOGGLE_PLAYBACK(guildID: string) {
		const queue = getQueue(guildID)
		if (!queue) return false
		return queue.wrapper.togglePlaying("web")
	}

	REPLY_SKIP(guildID: string) {
		const queue = getQueue(guildID)
		if (!queue) return false
		queue.wrapper.skip()
		return true
	}

	REPLY_STOP(guildID: string) {
		const queue = getQueue(guildID)
		if (!queue) return false
		queue.wrapper.stop()
		return true
	}

	REPLY_REMOVE_SONG(input: { guildID: string, index: number }) {
		const { guildID, index } = input
		const queue = getQueue(guildID)
		if (!queue) return false
		return queue.wrapper.removeSong(index, "web")
	}

	REPLY_SAVE_QUEUES() {
		return passthrough.queues.save()
	}

	REPLY_TOGGLE_AUTO(guildID: string) {
		const queue = getQueue(guildID)
		if (!queue) return false
		return queue.wrapper.toggleAuto("web")
	}

	REPLY_TOGGLE_LOOP(guildID: string) {
		const queue = getQueue(guildID)
		if (!queue) return false
		return queue.wrapper.toggleLoop("web")
	}

	REPLY_CLEAR_QUEUE(guildID: string) {
		const queue = getQueue(guildID)
		if (!queue) return false
		return queue.wrapper.removeAllSongs("web")
	}

	REPLY_GET_STATS() {
		return utils.getOwnStats()
	}

	REPLY_PING() {
		return true
	}

	REPLY_UPDATE_CONFIG(data: { config: any, lavalinkNodes: Array<boolean> } | undefined = undefined) {
		if (data && data.config) mixinDeep(config, data.config)
		if (data && data.lavalinkNodes) {
			constants.lavalinkNodes.forEach((n, i) => mixinDeep(n, data.lavalinkNodes[i]))
			utils.editLavalinkNodes.syncConnections()
		}
		return { config, lavalinkNodes: constants.lavalinkNodes }
	}

	async requestPing() {
		const d = Date.now()
		await this.request("PING")
		return Date.now() - d
	}

	requestGetGuildMember(guildID: string, userID: string): Promise<import("@amanda/discordtypings").MemberData> {
		return new Promise((resolve, reject) => {
			this.request("GET_GUILD_MEMBER", { guildID, userID }).then(result => {
				if (result.status == "ok") resolve(result.data)
				else reject(result.data)
			})
		})
	}

	/**
	 * Request and combine stats from all shards.
	 */
	requestGetAllStats(): Promise<import("../../typings").CombinedShardStats> {
		return this.request("GET_ALL_STATS", null)
	}

	sendNewQueue(queue: import("../../commands/music/queue").Queue) {
		const state = queue.wrapper.getState()
		this.ipc.send({ op: "NEW_QUEUE", data: { guildID: queue.guild.id, state } })
	}

	sendDeleteQueue(guildID: string) {
		this.ipc.send({ op: "NEW_QUEUE", data: { guildID, state: null } })
	}

	sendAddSong(queue: import("../../commands/music/queue").Queue, song: import("../../commands/music/songtypes").Song, position: number) {
		this.ipc.send({ op: "ADD_SONG", data: { guildID: queue.guild.id, position, song: song.getState() } })
	}

	sendTimeUpdate(queue: import("../../commands/music/queue").Queue) {
		this.ipc.send({ op: "TIME_UPDATE", data: { guildID: queue.guild.id, songStartTime: queue.songStartTime, pausedAt: queue.pausedAt, playing: !queue.isPaused } })
	}

	sendNextSong(queue: import("../../commands/music/queue").Queue) {
		this.ipc.send({ op: "NEXT_SONG", data: { guildID: queue.guild.id } })
	}

	sendSongUpdate(queue: import("../../commands/music/queue").Queue, song: import("../../commands/music/songtypes").Song, index: number) {
		this.ipc.send({ op: "SONG_UPDATE", data: { guildID: queue.guild.id, song: song.getState(), index: index } })
	}

	sendRemoveSong(queue: import("../../commands/music/queue").Queue, index: number) {
		this.ipc.send({ op: "REMOVE_SONG", data: { guildID: queue.guild.id, index: index } })
	}

	sendRemoveAllSongs(queue: import("../../commands/music/queue").Queue) {
		this.ipc.send({ op: "REMOVE_ALL_SONGS", data: { guildID: queue.guild.id } })
	}

	sendMembersUpdate(queue: import("../../commands/music/queue").Queue) {
		this.ipc.send({ op: "MEMBERS_UPDATE", data: { guildID: queue.guild.id, members: queue.wrapper.getMembers() } })
	}

	sendAttributesChange(queue: import("../../commands/music/queue").Queue) {
		this.ipc.send({ op: "ATTRIBUTES_CHANGE", data: { guildID: queue.guild.id, attributes: queue.wrapper.getAttributes() } })
	}

	sendBackgroundUpdateRequired() {
		this.ipc.send({ op: "BACKGROUND_UPDATE_REQUIRED", data: null })
	}

	sendPresenceAnnouncement(duration: number, message: string) {
		this.ipc.send({ op: "PRESENCE_ANNOUNCEMENT", data: { duration, message } })
	}

	sendSongTimeUpdate(queue: import("../../commands/music/queue").Queue, index: number, lengthSeconds: number) {
		this.ipc.send({ op: "SONG_TIME_UPDATE", data: { guildID: queue.guild.id, index, lengthSeconds } })
	}
}

const replier = new ClientReplier()
const oldReplier = ipc.replier
if (oldReplier) {
	replier.receivers = oldReplier.receivers
	replier.outgoing = oldReplier.outgoing
}
ipc.setReplier(replier)

export = ClientReplier
