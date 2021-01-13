// @ts-check

const Discord: typeof import("thunderstorm") = require("thunderstorm")
import { EventEmitter } from "events"

import passthrough from "../../passthrough"
const { client, reloader, ipc, config } = passthrough

import QueueFile from "../../commands/music/queue"
reloader.sync("./commands/music/queue.js", QueueFile)

import utils from "../utilities"
reloader.sync("./modules/utilities/index.js", utils)

const auditDestroyTimeout = 1000 * 60 * 5

class QueueManager {
	public cache: import("thunderstorm").Collection<string, import("../../commands/music/queue").Queue>
	public songsPlayed: number
	public events: EventEmitter
	public audits: Map<string, Array<{ action: string, platform: string, user: string }>>
	public enqueuedAuditDestructions: Map<string, NodeJS.Timeout>

	public constructor() {
		this.cache = new Discord.Collection()
		this.songsPlayed = 0
		this.events = new EventEmitter()
		this.audits = new Map()
		this.enqueuedAuditDestructions = new Map()
	}

	public toObject() {
		return {
			_id: `QueueStore_${config.cluster_id}`,
			queues: [...this.cache.values()].map(q => q.toObject())
		}
	}

	public async getOrCreate(voiceChannel: import("thunderstorm").VoiceChannel, textChannel: import("thunderstorm").PartialChannel, host: string | null = null): Promise<import("../../commands/music/queue").Queue> {
		const guildID = voiceChannel.guild.id
		if (this.cache.has(guildID)) return this.cache.get(guildID)!
		else {
			const q = await this.create(voiceChannel, textChannel, host)
			return q
		}
	}

	public async create(voiceChannel: import("thunderstorm").VoiceChannel, textChannel: import("thunderstorm").PartialChannel, host: string | null = null) {
		const guildID = voiceChannel.guild.id
		const guild = await utils.cacheManager.guilds.get(guildID) as import("thunderstorm").Guild
		if (this.audits.get(guildID)) {
			const existing = this.enqueuedAuditDestructions.get(guildID)
			if (existing) {
				clearTimeout(existing)
				this.enqueuedAuditDestructions.delete(guildID)
			}
		} else this.audits.set(guildID, [])
		const instance = new QueueFile.Queue(this, voiceChannel, textChannel, guild, host)
		this.cache.set(guildID, instance)
		ipc.replier!.sendNewQueue(instance)
		this.events.emit("create", instance)
		return instance
	}

	/**
	 * Remove a queue from the store
	 */
	public delete(guildID: string) {
		this.cache.delete(guildID)
		const timeout = setTimeout(() => this.audits.delete(guildID), auditDestroyTimeout)
		this.enqueuedAuditDestructions.set(guildID, timeout)
		ipc.replier?.sendDeleteQueue(guildID)
		this.events.emit("delete", guildID)
	}

	public save() {
		return passthrough.nedb.queue.update({ _id: `QueueStore_${config.cluster_id}` }, this.toObject(), { upsert: true })
	}

	public async restore() {
		const songTypes = await import("../../commands/music/songtypes")
		const data = await passthrough.nedb.queue.findOne({ _id: `QueueStore_${config.cluster_id}` })
		// @ts-ignore
		data.queues.forEach(async q => {
			// console.log(q)
			const guildID = q.guildID
			const voiceChannel = await utils.cacheManager.channels.get(q.voiceChannelID)
			const textChannel = await utils.cacheManager.channels.get(q.textChannelID)
			const host = q.host
			if (!(voiceChannel instanceof Discord.VoiceChannel) || !(textChannel instanceof Discord.TextChannel)) throw new Error("The IDs you saved don't match to channels, dummy")
			console.log(`Making queue for voice channel ${voiceChannel.name}`)
			const exists = this.cache.has(guildID)
			if (exists) console.log("Queue already in store! Skipping.")
			else {
				// @ts-ignore
				const queue = await this.getOrCreate(voiceChannel, textChannel, host)
				q.songs.forEach((s: any) => {
					if (s.class == "YouTubeSong") {
						const song = new songTypes.YouTubeSong(s.id, s.title, s.lengthSeconds, s.track, s.uploader)
						queue.songs.push(song)
						console.log(`Added YouTubeSong ${song.title}`)
					} else if (s.class == "FriskySong") {
						const song = new songTypes.FriskySong(s.station, { track: s.track })
						queue.songs.push(song)
						console.log(`Added FriskySong ${song.station}`)
					} else if (s.class === "SoundCloudSong") {
						const song = songTypes.makeSoundCloudSong(s.trackNumber, s.title, s.lengthSeconds, s.live, s.uri, s.track)
						queue.songs.push(song)
						console.log(`Added SoundCloudSong ${song.title}`)
					} else if (s.class === "SpotifySong") {
						// @ts-ignore
						const song = songTypes.makeSpotifySong({ track_number: s.trackNumber, duration_ms: s.durationMS, name: s.title, uri: s.uri, artists: [{ name: s.artist }] }, s.id, s.track)
						queue.songs.push(song)
						console.log(`Added SpotifySong ${song.title}`)
					} else if (s.class === "ExternalSong") {
						const song = songTypes.makeExternalSong(s.uri)
						// @ts-ignore
						queue.songs.push(song)
						console.log("Added ExternalSong")
					} else if (s.class === "ListenMoeSong") {
						const song = songTypes.makeListenMoeSong(s.station)
						queue.songs.push(song)
						console.log("Added ListenMoeSong")
					} else if (s.class === "NewgroundsSong") {
						const song = songTypes.makeNewgroundsSong(s)
						queue.songs.push(song)
						console.log("Added NewgroundsSong")
					}
				})
				if (queue.songs[0]) {
					queue.songs[0].resume()
				}
				queue.songStartTime = q.songStartTime
				queue.pausedAt = q.pausedAt
				const message = await client._snow.channel.getChannelMessage(q.textChannelID, q.npID).then(m => new Discord.Message(m, client))
				queue.np = message
				queue._startNPUpdates()
				queue._makeReactionMenu()
				ipc.replier!.sendNewQueue(queue)
			}
		})
		setTimeout(() => passthrough.nedb.queue.update({ _id: `QueueStore_${config.cluster_id}` }, { _id: `QueueStore_${config.cluster_id}`, queues: [] }, { upsert: true }), 1000 * 60 * 2)
	}
}

export = QueueManager
