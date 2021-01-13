/* eslint-disable no-empty-function */
/* eslint-disable @typescript-eslint/no-empty-function */

import Discord from "thunderstorm"
import path from "path"
import Lang from "@amanda/lang"
import ReactionMenu from "@amanda/reactionmenu"
// @ts-ignore
import mixinDeep from "mixin-deep"

import passthrough from "../../passthrough"
const { config, constants, client, reloader, ipc, internalEvents } = passthrough

let queues: import("../../modules/managers/QueueManager") | undefined = passthrough.queues ? passthrough.queues : undefined

const voiceEmptyDuration = 20000

import utils from "../../modules/utilities"
reloader.sync("./modules/utilities/index.js", utils)

import common from "./common.js"
reloader.sync("./commands/music/common.js", common)

utils.addTemporaryListener(internalEvents, "QueueManager", path.basename(__filename), (mngr: import("../../modules/managers/QueueManager")) => {
	queues = mngr
	passthrough.queues = mngr
}, "once")

class FrequencyUpdater {
	callback: () => any
	timeout: NodeJS.Timeout | null
	interval: NodeJS.Timeout | null
	/**
	 * @param {() => any} callback
	 */
	constructor(callback: () => any) {
		this.callback = callback
		this.timeout = null
		this.interval = null
	}
	start(frequency: number, trigger: boolean, delay: number = frequency) {
		this.stop(false)
		if (trigger) this.callback()
		this.timeout = setTimeout(() => {
			this.callback()
			this.interval = setInterval(() => {
				this.callback()
			}, frequency)
		}, delay)
	}
	stop(trigger = false) {
		if (this.timeout) clearTimeout(this.timeout)
		if (this.interval) clearInterval(this.interval)
		if (trigger) this.callback()
	}
}

export class Queue {
	public manager: import("../../modules/managers/QueueManager")
	public guild: Discord.Guild
	public voiceChannel: Discord.VoiceChannel
	public textChannel: Discord.PartialChannel
	public wrapper: QueueWrapper
	public listeners: Discord.Collection<string, Discord.GuildMember> = new Discord.Collection()
	public songStartTime = 0
	public pausedAt: number | null = null
	public songs: Array<import("./songtypes").Song> = []
	public auto = false
	public loop = false
	public errorChain = 0
	public shouldDisplayErrors = true
	public langCache: import("@amanda/lang").Lang | undefined = undefined
	public audit: Array<{ action: string; platform: string; user: string }> | undefined
	public voiceLeaveTimeout: import("../../modules/utilities/classes/BetterTimeout")
	public voiceLeaveWarningMessagePromise: Promise<Discord.Message> | null
	public nodeID: string
	public player: Promise<import("lavacord").Player>
	public np: Discord.Message | null
	public npMenu: ReactionMenu | null
	public npUpdater: FrequencyUpdater
	public dissolved = false
	public nightcore = false
	public antiNightcore = false
	public pitchAmount = 1
	public speedAmount = 1

	constructor(manager: typeof queues, voiceChannel: Discord.VoiceChannel, textChannel: Discord.PartialChannel, guild: Discord.Guild, host: string | null = null) {
		this.manager = manager as import("../../modules/managers/QueueManager")
		this.guild = guild
		this.voiceChannel = voiceChannel
		this.textChannel = textChannel
		this.wrapper = new QueueWrapper(this)
		this.audit = queues!.audits.get(this.guild.id)

		this.voiceLeaveTimeout = new utils.BetterTimeout()
			.setCallback(() => {
				this.getLang().then(lang => this.textChannel.send(lang.audio.music.prompts.everyoneLeft))
				this.audit?.push({ action: "Queue Destroy", platform: "System", user: "Amanda" })
				this.stop()
			})
			.setDelay(voiceEmptyDuration)

		this.voiceLeaveWarningMessagePromise = null
		if (!host) {
			const node = common.nodes.getByRegion(this.guild.region)
			host = node.id
		}
		this.nodeID = host
		this.player = client.lavalink.join({
			guild: this.guild.id,
			channel: this.voiceChannel.id,
			node: host
		})
		this.addPlayerListeners()
		/** @type {Discord.Message} */
		this.np = null
		this.npMenu = null
		this.npUpdater = new FrequencyUpdater(async () => {
			if (this.np) {
				const embed = await this._buildNPEmbed()
				if (embed) this.np.edit(embed)
			}
		})
		this.getLang().then(lng => this.langCache = lng)
	}
	async addPlayerListeners() {
		const player = await this.player
		player.on("end", event => this._onEnd(event))
		player.on("playerUpdate", async data => {
			if (!this.isPaused) {
				const lang = await this.getLang()
				const newSongStartTime = (data.state.time || 0) - (data.state.position || 0)
				// commenting this out: it may break the error check, but it will improve the web time
				// if (Math.abs(newSongStartTime - this.songStartTime) > 100 && data.state.position !== 0) {
				this.songStartTime = newSongStartTime
				ipc.replier!.sendTimeUpdate(this)
				// }
				if (newSongStartTime > this.songStartTime + 3500 && data.state.position === 0) {
					if (!this.songs[0].error) {
						console.log(
							"Song didn't start."
							+ ` Region: ${this.guild.region}`
							+ `, guildID: ${this.guild.id}`
						)
						this.songs[0].error = lang.audio.music.prompts.songNotPlayingDiscord
					}
					console.log("Song error call A")
					this._reportError()
				}
			}
		})
		player.on("error", details => {
			if (details.type === "WebSocketClosedEvent") {
				// Caused when either voice channel deleted, or someone disconnected Amanda through context menu
				// Simply respond by stopping the queue, since that was the intention.
				// This should therefore clean up the queueStore and the website correctly.
				this.audit!.push({ action: "Queue Destroy (Error Occurred)", platform: "System", user: "Amanda" })
				return this.stop()
			}
			console.error("Lavalink error event at", new Date().toUTCString(), details)
			if (this.songs[0]) {
				this.songs[0].error = details.error ? details.error : `\`\`\`js\n${JSON.stringify(details, null, 4)}\n\`\`\``
				console.log("Song error call B")
				this._reportError()
				// This may automatically continue to the next song, presumably because the end event may also be fired.
			}
		})
	}
	getLang(): Promise<import("@amanda/lang").Lang> {
		if (this.langCache) return Promise.resolve(this.langCache)
		return utils.getLang(this.guild.id, "guild")
	}
	toObject() {
		return {
			guild: this.guild.toJSON(),
			voiceChannelID: this.voiceChannel.id,
			textChannelID: this.textChannel.id,
			songStartTime: this.songStartTime,
			pausedAt: this.pausedAt,
			npID: this.np ? this.np.id : null,
			songs: this.songs.map(s => s.toObject()),
			host: this.nodeID
		}
	}

	/**
	 * Start playing the top song in the queue.
	 */
	async play() {
		const lang = await this.getLang()
		const song = this.songs[0]
		if (this.songs[1]) this.songs[1].prepare()
		await song.prepare()
		if (!song.error) {
			if (song.track == "!") song.error = lang.audio.music.prompts.songErrorExclaimation
			else if (song.track == null) song.error = lang.audio.music.prompts.songErrorNull
		}
		if (song.error) {
			console.error("Song error call C:")
			console.error("id:", song.id, "/ error:", song.error)
			this._reportError()
			this._nextSong()
		} else {
			passthrough.periodicHistory.add("song_start")
			const player = await this.player
			player.play(song.track).then(() => {
				this.songStartTime = Date.now()
				this.pausedAt = null
				this._startNPUpdates()
				this.sendNewNP()
			})
		}
	}

	async _reportError() {
		const lang = await this.getLang()
		const sendReport = (contents: any) => {
			// Report to original channel
			this.textChannel.send(contents)
			// Report to #amanda-error-log
			const reportTarget = "512869106089852949"
			const embed = new Discord.MessageEmbed()
			embed.setTitle("Music error occurred.")
			embed.setDescription("The next message is the message that was sent to the user.")
			const nodeID = this.nodeID
			const node = common.nodes.getByID(nodeID)
			const details = [
				["Cluster", config.cluster_id],
				["Guild", this.guild.name],
				["Guild ID", this.guild.id],
				["Text channel", this.textChannel.id],
				["Voice channel", this.voiceChannel.id],
				["Using Invidious", String(config.use_invidious)],
				["Invidious origin", `\`${node.invidious_origin}\``],
				["Queue node", node ? node.name : "Unnamed"]
			]
			const maxLength = details.reduce((p, c) => Math.max(p, c[0].length), 0)
			const detailsString = details.map(row =>
				`\`${row[0]}${" ​".repeat(maxLength - row[0].length)}\` ${row[1]}` // SC: space + zwsp, wide space
			).join("\n")
			embed.addField(
				"Details",
				detailsString
			)
			embed.setColor(0xff2ee7)
			const rchan = new Discord.PartialChannel({ id: reportTarget }, client)
			rchan.send(embed).then(() => {
				return rchan.send(contents)
			}).catch(() => {}) // probably missing access error
		}
		this.errorChain++
		if (this.shouldDisplayErrors) {
			const song = this.songs[0]
			if (song) {
				const embed = new Discord.MessageEmbed()
					.setTitle(lang.audio.music.prompts.songNotPlayable)
					.setDescription(
						`**${Discord.Util.escapeMarkdown(song.title)}** (ID: ${song.id})`
					+ `\n${song.error}`
					)
					.setColor(0xdd2d2d)
				sendReport(embed)
			} else {
				const embed = new Discord.MessageEmbed()
					.setTitle(lang.audio.music.prompts.errorOccured)
					.setDescription(utils.replace(lang.audio.music.prompts.songErrorNotObject, { "song": song }))
					.setColor(0xdd2d2d)
				sendReport(embed)
			}
			if (this.errorChain >= 3) {
				this.shouldDisplayErrors = false
				this.textChannel.send(
					await utils.contentify(
						// @ts-ignore
						this.textChannel,
						new Discord.MessageEmbed()
							.setTitle(lang.audio.music.prompts.tooManyErrors)
							.setDescription(lang.audio.music.prompts.errorsSuppressed)
							.setColor(0xff2ee7)
					)
				)
			}
		}
	}

	/**
	 * Start updating the now playing message.
	 */
	_startNPUpdates() {
		if (!this.songs[0]) return console.log("Tried to call Queue._startNPUpdates but no songs")
		const frequency = this.songs[0].npUpdateFrequency
		const timeUntilNext5 = frequency - ((Date.now() - this.songStartTime) % frequency)
		const triggerNow = timeUntilNext5 > 1500
		// console.log(frequency, Date.now(), this.songStartTime, timeUntilNext5, triggerNow)
		this.npUpdater.start(frequency, triggerNow, timeUntilNext5)
	}

	/**
	 * Called when the player emits the "end" event.
	 */
	_onEnd(event: import("lavacord").LavalinkEvent) {
		if (event.reason == "REPLACED") return
		if (event.type === "TrackStuckEvent") {
			this.audit!.push({ action: "Queue Skip (Song got stuck)", platform: "System", user: "Amanda" })
			if (this.songs[0]) {
				let reason = ""
				if (event.error) reason += `${event.error}\n`
				if (event.reason) reason += event.reason
				this.songs[0].error = reason ? reason : `\`\`\`js\n${JSON.stringify({ error: "Track got stuck" }, null, 4)}`
				console.log("Song error call D")
				this._reportError()
			}
		}
		this._nextSong()
	}

	async _nextSong() {
		const lang = await this.getLang()
		if (this.songs[1] && this.songs[1].live && (this.nightcore || this.antiNightcore || (this.speedAmount != 1))) {
			this.nightcore = false
			this.antiNightcore = false
			await this.speed(1.0, true)
		}
		// Special case for loop 1
		if (this.songs.length === 1 && this.loop && !this.songs[0].error) {
			this.play()
			return
		}

		// Destroy current song (if loop is disabled)
		if (this.songs[0] && (!this.loop || this.songs[0].error)) this.songs[0].destroy()
		// Out of songs? (This should only pass if loop mode is also disabled.)
		if (this.songs.length <= 1) {
			// Is auto mode on?
			if (this.auto) {
				// Store the current song
				const lastPlayed = this.songs[0]
				// Get related
				const related = await lastPlayed.getRelated()
				// Can we play a related song?
				if (related.length) {
					this.songs.shift()
					this.addSong(related[0])
					ipc.replier!.sendNextSong(this)
				} else { // No related songs. Dissolve.
					this.textChannel.send(lang.audio.music.prompts.autoRanOut)
					this.auto = false
					this.audit!.push({ action: "Queue Destroy", platform: "System", user: "Amanda" })
					this._clearSongs()
					this._dissolve()
				}
			} else { // Auto mode is off. Dissolve.
				this.audit!.push({ action: "Queue Destroy", platform: "System", user: "Amanda" })
				this._clearSongs()
				this._dissolve()
			}
		} else { // We have more songs. Move on.
			const removed = this.songs.shift()
			ipc.replier?.sendNextSong(this)
			// In loop mode, add the just played song back to the end of the queue.
			if (this.loop && !removed?.error) {
				this.addSong(removed as import("./songtypes").Song)
			}
			this.play()
		}
	}
	_clearSongs() {
		this.songs.forEach(song => {
			song.destroy()
		})
		this.songs = []
	}
	/**
	 * Deconstruct the queue:
	 *
	 * Stop updating the now playing message.
	 * Leave the voice channel.
	 *
	 * You probably ought to make sure songs is empty and nothing is playing before calling.
	 */
	_dissolve() {
		if (this.dissolved) return
		this.dissolved = true
		this.npUpdater.stop(false)
		if (this.npMenu) this.npMenu.destroy(true, "text")
		client.lavalink.leave(this.guild.id)
		this.manager.delete(this.guild.id)
	}

	/**
	 * Pause playback.
	 */
	async pause(): Promise<string | null> {
		if (this.songs[0].noPauseReason) return this.songs[0].noPauseReason
		else if (this.isPaused) {
			if (this.langCache) return this.langCache.audio.music.prompts.queueAlreadyPaused
			else return "Music is already paused. Use `&music resume` to resume."
		} else {
			const player = await this.player
			this.pausedAt = Date.now()
			player.pause(true)
			this.npUpdater.stop(true)
			ipc.replier!.sendTimeUpdate(this)
			return null
		}
	}

	/**
	 * Resume playback.
	 * Returns 0 on success.
	 * Returns 1 if the queue wasn't paused.
	 */
	async resume(): Promise<0 | 1> {
		if (!this.isPaused) return 1
		else {
			const player = await this.player
			const pausedTime = Date.now() - (this.pausedAt || 0)
			this.songStartTime += pausedTime
			this.pausedAt = null
			player.resume().then(() => {
				this._startNPUpdates()
			})
			ipc.replier!.sendTimeUpdate(this)
			return 0
		}
	}

	/**
	 * Skip the current song by asking the player to stop.
	 */
	async skip(amount?: number) {
		if (amount) {
			for (let i = 1; i <= amount - 1; i++) { // count from 1 to amount-1, inclusive
				this.removeSong(1, true)
			}
		}
		const player = await this.player
		player.stop()
	}

	/**
	 * End playback by clearing the queue, then asking the player to stop.
	 */
	async stop() {
		const player = await this.player
		this._clearSongs()
		this.loop = false
		this.auto = false
		player.stop()
		this._dissolve()
	}
	/**
	 * @returns Returns 0 on success. 1 if no song. 2 if the song is live. 3 if the position is > song length. 4 if error
	 */
	async seek(position: number) {
		const song = this.songs[0]
		if (!song) return 1
		if (song.live) return 2
		if (position > (song.lengthSeconds * 1000)) return 3
		const player = await this.player
		const result = await player.seek(position)
		if (result) return 0
		else return 4
	}

	toggleAuto() {
		this.auto = !this.auto
		ipc.replier!.sendAttributesChange(this)
	}

	toggleLoop() {
		this.loop = !this.loop
		ipc.replier!.sendAttributesChange(this)
	}

	/**
	 * Add a song to the end of the queue.
	 * Returns 0 on ordinary success.
	 * Returns 1 if this made the queue non-empty and started playback.
	 */
	addSong(song: import("./songtypes").Song, insert?: number | boolean): 0 | 1 {
		let position = -1 // the actual position to insert into, `undefined` to push
		if (insert == undefined) { // no insert? just push
			position = -1
		} else if (typeof (insert) == "number") { // number? insert into that point
			position = insert
		} else if (typeof (insert) == "boolean") { // boolean?
			if (insert) position = 1 // if insert is true, insert
			else position = -1 // otherwise, push
		}
		song.queue = this
		if (position == -1) this.songs.push(song)
		else this.songs.splice(position, 0, song)
		ipc.replier?.sendAddSong(this, song, position)
		if (this.songs.length == 2) song.prepare()
		if (this.songs.length == 1) {
			this.play()
			return 1
		} else return 0
	}

	/**
	 * Returns 0 on success.
	 * Returns 1 if the index is out of range.
	 * Returns 2 if index exists, but removed item was undefined.
	 */
	removeSong(index: number, broadcast: boolean) {
		// Validate index
		if (index == 0) return 1
		if (!this.songs[index]) return 1
		// Broadcast
		if (broadcast) ipc.replier?.sendRemoveSong(this, index)
		// Actually remove
		const removed = this.songs.splice(index, 1)[0]
		if (!removed) return 2
		removed.destroy()
		return 0
	}

	/**
	 * Remove all songs from the queue except for the currently playing one.
	 */
	removeAllSongs(): number {
		const removed = this.songs.splice(1)
		for (const item of removed) {
			item.destroy()
		}
		ipc.replier?.sendRemoveAllSongs(this)
		return removed.length
	}

	/**
	 * Play something from the list of related items.
	 * Returns 0 on success.
	 * Returns 1 if the index is out of range.
	 */
	async playRelated(index: number, insert: boolean): Promise<0 | 1> {
		if (typeof index != "number" || isNaN(index) || index < 0 || Math.floor(index) != index) return 1
		const related = await this.songs[0].getRelated()
		const item = related[index]
		if (!item) return 1
		this.addSong(item, insert)
		return 0
	}
	/**
	 * Sets the volume of the player.
	 * Returns 0 on success.
	 * Returns 1 if there is no song.
	 * Returns 2 if there is no result.
	 * @param num A float defaulting to 1.0
	 */
	async volume(num = 1.0) {
		if (!this.songs[0]) return 1
		const player = await this.player
		const result = await player.volume(num)
		if (result) return 0
		else return 2
	}
	/**
	 * Sets the pitch of the player.
	 * Returns 0 on success.
	 * Returns 1 if there is no song.
	 * Returns 2 if there is no result.
	 * @param {number} num A float defaulting to 1.0
	 * @param {boolean} apply Whether or not the method should assign the number to the queue attributes
	 */
	async pitch(num = 1.0, apply = true) {
		if (!this.songs[0]) return 1
		const player = await this.player
		const oldFilters = Discord.Util.cloneObject(player.state.filters) // Object.assign is mutative
		const newFilters = mixinDeep(oldFilters, { timescale: { pitch: num } })
		const result = await player.filters(newFilters)
		if (result) {
			if (apply) this.pitchAmount = num
			return 0
		} else return 2
	}
	/**
	 * Sets the speed of the player.
	 * Returns 0 on success.
	 * Returns 1 if there is no song.
	 * Returns 2 if the song is live.
	 * Returns 3 if there is no result.
	 * @param {number} num A float defaulting to 1.0
	 * @param {boolean} apply Whether or not the method should assign the number to the queue attributes
	 */
	async speed(num = 1.0, apply = true) {
		if (!this.songs[0]) return 1
		if (this.songs[0].live) return 2
		const player = await this.player
		const oldFilters = Discord.Util.cloneObject(player.state.filters) // Object.assign is mutative
		const newFilters = mixinDeep(oldFilters, { timescale: { speed: num } })
		const result = await player.filters(newFilters)
		if (result) {
			if (apply) this.speedAmount = num
			ipc.replier!.sendAttributesChange(this)
			return 0
		} else return 3
	}

	get time() {
		if (this.isPaused && this.pausedAt) return this.pausedAt - this.songStartTime
		else return Date.now() - this.songStartTime
	}

	get timeSeconds() {
		return Math.round(this.time / 1000)
	}

	get isPaused() {
		return !!this.pausedAt
	}

	getTotalLength() {
		return this.songs.reduce((acc, cur) => (acc + cur.lengthSeconds), 0)
	}

	/**
	 * Create and return an embed containing details about the current song.
	 *	Returns null if no songs.
	 */
	async _buildNPEmbed() {
		const song = this.songs[0]
		if (song) {
			const embed = new Discord.MessageEmbed()
			const lang = this.langCache || Lang.en_us
			const progress = song.getProgress(this.timeSeconds, this.isPaused)
			const link = await song.showLink()
			embed.setDescription(utils.replace(lang.audio.music.prompts.queueNowPlaying, { "song": `[**${Discord.Util.escapeMarkdown(song.title)}**](${link})\n\n${progress}` }))
			embed.setColor(constants.standard_embed_color)
			return embed
		} else return null
	}

	/**
	 * Send a new now playing message and generate reactions on it. Destroy the previous reaction menu.
	 * This can be called internally and externally.
	 */
	async sendNewNP(force = false) {
		if (this.np && !force) return Promise.resolve()
		else {
			const result = await this._buildNPEmbed()
			return this.textChannel.send(result ? result : `You found a bug. There were no songs in the queue when the now playing message was told to send. If a song is currently playing, try \`&now\` to fix it. Please report this bug here: <${constants.server}>. Or don't ¯\\\\\\_(ツ)\\_/¯`).then(x => {
				this.np = x
				this._makeReactionMenu()
			})
		}
	}

	_makeReactionMenu() {
		if (this.npMenu) this.npMenu.destroy(true, "text")
		// @ts-ignore
		this.npMenu = new ReactionMenu(this.np, client, [
			{ emoji: "⏯", remove: "user", actionType: "js", actionData: (msg, emoji, user) => {
				if (!this.listeners.has(user!.id)) return
				this.audit!.push({ action: this.isPaused ? "Queue Resume" : "Queue Pause", platform: "Discord", user: user!.tag })
				this.wrapper.togglePlaying("reaction")
			} },
			{ emoji: "⏭", remove: "user", actionType: "js", actionData: (msg, emoji, user) => {
				if (!this.listeners.has(user!.id)) return
				this.audit!.push({ action: "Queue Skip", platform: "Discord", user: user!.tag })
				this.wrapper.skip()
			} },
			{ emoji: "⏹", remove: "user", actionType: "js", actionData: (msg, emoji, user) => {
				if (!this.listeners.has(user!.id)) return
				this.audit!.push({ action: "Queue Destroy", platform: "Discord", user: user!.tag })
				this.wrapper.stop()
			} }
		])
	}

	async voiceStateUpdate(newState: Discord.VoiceState) {
		const lang = await this.getLang()
		// Update own channel
		if (newState.id == client.user!.id && newState.channelID && newState.channelID !== this.voiceChannel.id) {
			// @ts-ignore
			this.voiceChannel = await utils.cacheManager.channels.get(newState.channelID, true, true)
		}
		const count = this.listeners.filter(item => item.user && !item.user.bot).size
		if (!count) {
			let mems: Array<Discord.GuildMember>
			if (newState.channelID) {
				const indexes = await client.rain.cache.voiceState.getIndexMembers()
				const filtered = []
				for (const ind of indexes) {
					const result = await client.rain.cache.voiceState.get(ind, newState.guildID!)
					if (result && result.boundObject!.channel_id === this.voiceChannel.id) filtered.push(result)
				}
				// @ts-ignore
				mems = await Promise.all(filtered.map(s => utils.cacheManager.members.get(s.user_id, newState.guildID, true, true)))
			} else mems = []
			if (mems.length > 0 && mems.find(i => !i.user.bot)) {
				for (const mem of mems) {
					this.listeners.set(mem.id, mem)
				}
			} else {
				if (!this.voiceLeaveTimeout.isActive) {
					this.voiceLeaveTimeout.run()
					this.voiceLeaveWarningMessagePromise = this.textChannel.send(utils.replace(lang.audio.music.prompts.noUsersLeft, { "time": this.voiceLeaveTimeout.delay! / 1000 }))
				}
			}
		} else {
			this.voiceLeaveTimeout.clear()
			if (this.voiceLeaveWarningMessagePromise) {
				this.voiceLeaveWarningMessagePromise.then(msg => {
					msg.delete()
					this.voiceLeaveWarningMessagePromise = null
				})
			}
		}
		// Broadcast to web
		ipc.replier!.sendMembersUpdate(this)
	}
}

export class QueueWrapper {
	queue: Queue

	constructor(queue: Queue) {
		this.queue = queue
	}

	toggleAuto(context?: any) {
		this.queue.toggleAuto()
		const auto = this.queue.auto
		if (context instanceof Discord.Message) {
			this.queue.getLang().then(lang => {
				context.channel.send(auto ? lang.audio.music.prompts.autoOn : lang.audio.music.prompts.autoOff)
			})
			this.queue.audit?.push({ action: "Queue Auto Toggle", platform: "Discord", user: context.author.tag })
		} else if (context === "web") {
			this.queue.audit?.push({ action: "Queue Auto Toggle", platform: "Web", user: "Unkown" })
			return true
		}
	}

	toggleLoop(context: any) {
		this.queue.toggleLoop()
		const loop = this.queue.loop
		if (context instanceof Discord.Message) {
			this.queue.getLang().then(lang => {
				context.channel.send(loop ? lang.audio.music.prompts.loopOn : lang.audio.music.prompts.loopOff)
			})
			this.queue.audit?.push({ action: "Queue Loop Toggle", platform: "Discord", user: context.author.tag })
		} else if (context === "web") {
			this.queue.audit?.push({ action: "Queue Loop Toggle", platform: "Web", user: "Unkown" })
			return true
		}
	}

	togglePlaying(context: any) {
		if (this.queue.isPaused) return this.resume(context)
		else return this.pause(context)
	}

	async pause(context: any) {
		const result = await this.queue.pause()
		if (context === "web") {
			if (!result) this.queue.audit?.push({ action: "Queue Pause", platform: "Web", user: "Unkown" })
			return !result
		}
		if (context instanceof Discord.Message && !result) this.queue.audit?.push({ action: "Queue Pause", platform: "Discord", user: context.author.tag })
		if (result) {
			if (context instanceof Discord.Message) context.channel.send(result)
			else if (context === "reaction") this.queue.textChannel.send(result)
		}
	}

	async resume(context: any) {
		const result = await this.queue.resume()
		if (context instanceof Discord.Message && result == 0) this.queue.audit?.push({ action: "Queue Resume", platform: "Discord", user: context.author.tag })
		if (result == 1) {
			if (context instanceof Discord.Message) {
				this.queue.getLang().then(lang => {
					context.channel.send(lang.audio.music.prompts.musicPlaying)
				})
			}
		}
		if (context === "web") {
			if (result == 0) this.queue.audit?.push({ action: "Queue Resume", platform: "Web", user: "Unkown" })
			return !result
		}
	}

	skip(amount?: number) {
		this.queue.skip(amount)
	}

	stop() {
		this.queue.stop()
	}
	/**
	 * @param {Discord.PartialChannel} channel
	 */
	async showRelated(channel: Discord.Message["channel"]) {
		if (!this.queue.songs[0]) return // failsafe. how did this happen? no idea. just do nothing.
		if (this.queue.songs[0].typeWhileGetRelated) await channel.sendTyping()
		const content = await this.queue.songs[0].showRelated()
		channel.send(content)
	}
	/**
	 * Permitted contexts:
	 * - A message `&m q remove 2`. A reaction will be added, or an error message will be sent.
	 * - The string "web". The return value will be a boolean indicating success.
	 * @param {number} index One-based index.
	 * @param {any} [context]
	 */
	removeSong(index: number, context: any) {
		if (context instanceof Discord.Message) {
			this.queue.getLang().then(lang => {
				if (!index) {
					context.channel.send(lang.audio.music.prompts.songRemoveRequired)
				} else {
					const result = this.queue.removeSong(index - 1, true)
					if (result === 1) {
						if (index === 1) {
							context.channel.send(lang.audio.music.prompts.songRemove1)
						} else {
							context.channel.send(utils.replace(lang.audio.music.prompts.queueSongTotal, { "number1": this.queue.songs.length, "number2": this.queue.songs.length }))
						}
					} else {
						this.queue.audit?.push({ action: "Queue Song Remove", platform: "Discord", user: context.author.tag })
						context.react("✅")
					}
				}
			})
		} else if (context === "web") {
			if (!index) {
				return false
			} else {
				const result = this.queue.removeSong(index - 1, true)
				if (result == 0) this.queue.audit?.push({ action: "Queue Song Remove", platform: "Web", user: "Unknown" })
				return result !== 1
			}
		}
	}
	/**
	 * Remove all songs from the queue except for the currently playing one.
	 */
	removeAllSongs(context: any) {
		const numberOfSongs = this.queue.removeAllSongs()
		if (context && context.msg && context.msg instanceof Discord.Message) {
			context.msg.channel.send(
				utils.replace(context.lang.audio.music.returns.queueClear, {
					"number": `${numberOfSongs} ${numberOfSongs === 1 ? "song" : "songs"}`
				})
			)
		} else if (context === "web") {
			return true
		}
	}
	/**
	 * @param {Discord.PartialChannel} channel
	 */
	async showInfo(channel: Discord.Message["channel"]) {
		const content = await this.queue.songs[0].showInfo()
		channel.send(content)
	}
	/**
	 * Permitted contexts:
	 * - A message `&m rel p 1`. A reaction will be added, or an error message will be sent.
	 * @param {number} index One-based index.
	 * @param {boolean} insert
	 * @param {any} [context]
	 */
	async playRelated(index: number, insert: boolean, context: any) {
		const lang = await this.queue.getLang()
		index--
		const result = await this.queue.playRelated(index, insert)
		if (context instanceof Discord.Message) {
			if (result == 0) context.react("✅")
			else if (result == 1) context.channel.send(lang.audio.music.prompts.numberNotInRelated)
		}
	}

	getMembers() {
		return this.queue.listeners.map(m => ({
			id: m.id,
			name: m.displayName,
			avatar: m.user.displayAvatarURL({ format: "png", size: 64, dynamic: false }),
			isAmanda: m.id == client.user?.id
		}))
	}

	getAttributes() {
		return {
			auto: this.queue.auto,
			loop: this.queue.loop,
			speed: this.queue.speedAmount
		}
	}

	getState() {
		return {
			guildID: this.queue.guild.id,
			playing: !this.queue.isPaused,
			songStartTime: this.queue.songStartTime,
			pausedAt: this.queue.pausedAt,
			songs: this.queue.songs.map(s => s.getState()),
			members: this.getMembers(),
			voiceChannel: {
				id: this.queue.voiceChannel.id,
				name: this.queue.voiceChannel.name
			},
			attributes: this.getAttributes()
		}
	}
}

export default { Queue, QueueWrapper }

/**
 * @typedef {Object} LLEndEvent
 * @property {string} guildId
 * @property {string} reason
 * @property {string} track
 * @property {"event"} op
 * @property {"TrackEndEvent"} type
 */
