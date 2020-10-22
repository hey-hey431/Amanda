/* eslint-disable no-useless-catch */
// @ts-check

/** @type {import("node-fetch").default} */
const fetch = require("node-fetch")
const Discord = require("thunderstorm")
const path = require("path")
const { encode } = require("@lavalink/encoding")
const genius = require("genius-lyrics-api")

const passthrough = require("../../passthrough")
const { client, reloader, config, constants } = passthrough

const utils = require("../../modules/utilities")
reloader.sync("./modules/utilities/index.js", utils)

const Util = require("discord.js/src/util/Util")

class VoiceStateCallback {
	/**
	 * @param {Discord.Message} msg
	 * @param {number} timeoutMs
	 * @param {(voiceChannel: Discord.VoiceChannel) => any} callback
	 * @constructor
	 */
	constructor(msg, timeoutMs, callback) {
		this.msg = msg
		this.guildID = msg.guild.id
		this.timeout = setTimeout(() => this.cancel(), timeoutMs)
		this.callback = callback
		this.active = true
		common.voiceStateCallbackManager.getAll(this.msg.author.id, this.msg.guild).forEach(o => o.cancel()) // this works? (common declared later)
		this.add()
	}
	add() {
		common.voiceStateCallbackManager.callbacks.push(this)
	}
	remove() {
		const index = common.voiceStateCallbackManager.callbacks.indexOf(this)
		if (index != -1) common.voiceStateCallbackManager.callbacks.splice(index, 1)
	}
	/**
	 * @param {Discord.VoiceChannel} voiceChannel
	 */
	async trigger(voiceChannel) {
		let lang
		const selflang = await utils.sql.get("SELECT * FROM SettingsSelf WHERE keyID =? AND setting =?", [this.msg.author.id, "language"])
		if (selflang) lang = await utils.getLang(this.msg.author.id, "self")
		else if (this.msg.guild) lang = await utils.getLang(this.msg.guild.id, "guild")
		else lang = await utils.getLang(this.msg.author.id, "self")
		if (this.active) {
			const checkedVoiceChannel = await common.verifyVoiceChannel(voiceChannel, this.msg, lang)
			if (checkedVoiceChannel) {
				// All good!
				this.active = false
				clearTimeout(this.timeout)
				this.remove()
				this.callback(voiceChannel)
			}
			// Else, couldn't join or speak. We'll keep this active in case they switch channels.
		}
	}
	cancel() {
		if (this.active) {
			this.active = false
			clearTimeout(this.timeout)
			this.remove()
			this.callback(null)
		}
	}
}

const common = {
	/**
	 * @param {number} seconds
	 */
	prettySeconds: function(seconds) {
		let minutes = Math.floor(seconds / 60)
		seconds = seconds % 60
		const hours = Math.floor(minutes / 60)
		minutes = minutes % 60
		const output = []
		if (hours) {
			output.push(hours)
			output.push(minutes.toString().padStart(2, "0"))
		} else {
			output.push(minutes)
		}
		output.push(seconds.toString().padStart(2, "0"))
		return output.join(":")
	},

	inputToID:
	/**
	 * @param {string} input
	 * @returns {({type: string, id?: string, list?: string, link?: string})|null}
	 */
	function(input) {
		input = input.replace(/(<|>)/g, "")
		try {
			let inputAsURL = input
			if (inputAsURL.includes(".com/") && !inputAsURL.startsWith("http")) inputAsURL = `https://${inputAsURL}`
			const url = new URL(inputAsURL)
			// It's a URL.
			if (url.hostname.startsWith("www.")) url.hostname = url.hostname.slice(4)
			// Is it SoundCloud?
			if (url.hostname === "soundcloud.com") {
				// Bam, done.
				return { type: "soundcloud", link: url.toString() }
			} else if (url.hostname == "open.spotify.com" && (url.pathname.startsWith("/playlist") || url.pathname.startsWith("/track"))) {
				return { type: "spotify", link: url.toString() }
			} else if (url.hostname == "cadence.moe" || url.hostname == "cadence.gq") { // Is it CloudTube?
				try {
					const id = url.pathname.match(/video\/([\w-]{11})$/)[1]
					// Got an ID!
					return { type: "video", id: id }
				} catch (e) {
					// Didn't match.
					return null
				}
			} else if (url.hostname == "youtu.be") { // Is it youtu.be?
				const id = url.pathname.slice(1)
				return { type: "video", id: id }
			} else if (url.hostname == "youtube.com" || url.hostname == "invidio.us" || url.hostname == "hooktube.com") { // Is it YouTube-compatible?
				// Is it a playlist?
				if (url.searchParams.get("list")) {
					const result = { type: "playlist", list: url.searchParams.get("list") }
					const id = url.searchParams.get("v")
					if (id) result.id = id
					return result
				} else if (url.pathname == "/watch") { // Is it a video?
					const id = url.searchParams.get("v")
					// Got an ID!
					return { type: "video", id: id }
				} else return null // YouTube-compatible, but can't resolve to a video.
			} else return null // Unknown site.
		} catch (e) {
			// Not a URL. Might be an ID?
			if (input.match(/^[A-Za-z0-9_-]{11}$/)) return { type: "video", id: input }
			else return null
		}
	},

	/**
	 * Call /loadtracks on the first node using the passed identifier.
	 * Throws exception.message.
	 * @param {string} input
	 * @param {string} [region]
	 * @returns {Promise<{track: string, info: import("../../typings").LavalinkInfo}[]>}
	 */
	getTracks: function(input, region = "") {
		const node = common.nodes.getByRegion(region)

		const params = new URLSearchParams()
		params.append("identifier", input)

		return fetch(`http://${node.host}:${node.port}/loadtracks?${params.toString()}`, {
			headers: {
				"Authorization": node.password
			}
		}).then(async data => {
			const json = await data.json()
			if (json.exception) throw json.exception.message
			// sometimes the track length can be extremely long and it doesn't play.
			// length > 24h is probably the glitch, and for some reason we can avoid it by searching for the track instead
			if (input.length === 11 && json.tracks && json.tracks[0] && json.tracks[0].info && json.tracks[0].info.length > 24 * 60 * 60 * 1000) {
				const searchTracks = await common.getTracks(`ytsearch:${input}`, region)
				const filteredTracks = searchTracks.filter(t => t.info.identifier === json.tracks[0].info.identifier)
				if (filteredTracks.length) Object.assign(json, { tracks: filteredTracks })
			}
			return json.tracks
		})
	},

	searchYouTube: function(input, region = "") {
		const node = common.nodes.getByRegion(region)
		if (node.search_with_invidious) {
			let d
			try {
				d = common.invidious.search(input, node.host).then(common.invidious.searchResultsToTracks)
			} catch {
				return []
			}
			return d
		} else {
			return common.getTracks(`ytsearch:${input}`, region)
		}
	},

	genius: {
		/**
		 * @param {string} title
		 * @param {string} artist
		 * @returns {Promise<?string>}
		 */
		getLyrics: function(title, artist = undefined) {
			const options = {
				apiKey: config.genius_access_token,
				title: title,
				artist: artist,
				optimizeQuery: true
			}
			return genius.getLyrics(options)
		},
		/**
		 * @param {import("./songtypes").Song} song
		 */
		pickApart(song) {
			const songTypes = require("./songtypes")

			const expressions = [
				/([^|[\]]+?) ?(?:[-–—]|\bby\b) ?([^()[\],]+)?/, // (Toni Romiti) - (Switch Up )\(Ft. Big Rod\) | Non escaped () means cap group
				/([^-]+) - Topic/ // If the artist is officially uploaded by YouTube. Sucks to suck if they have a - in their name
			]

			let title, artist

			const standard = () => {
				const match = song.title.match(expressions[0])
				if (match) {
					title = match[2]
					artist = match[1]
				}
				if (!title || !artist) {
					if (song instanceof songTypes.YouTubeSong) {
						title = song.title
						artist = song.uploader
					}
				}
			}

			if (song instanceof songTypes.SpotifySong || song instanceof songTypes.SoundCloudSong) {
				title = song.title
				artist = song.artist
			} else if (song instanceof songTypes.YouTubeSong) {
				if (song.uploader) {
					const topic = song.uploader.match(expressions[1])
					if (topic) {
						title = song.title
						artist = topic[1]
					} else standard()
				} else standard()
			}

			return { title, artist }
		}
	},

	nodes: {
		lowUsage() {
			return client.lavalink.idealNodes.map(node => constants.lavalinkNodes.find(n => n.host === node.host)).filter(node => node.enabled)
		},

		first() {
			return constants.lavalinkNodes.find(n => n.enabled)
		},

		getByHost(host) {
			return constants.lavalinkNodes.find(n => n.enabled && n.host === host) || common.nodes.first()
		},

		getByID(id) {
			return constants.lavalinkNodes.find(n => n.enabled && n.id == id) || common.nodes.first()
		},

		getByRegion(region) {
			return constants.lavalinkNodes.find(n => n.enabled && n.regions.includes(region)) || common.nodes.first()
			// eslint-disable-next-line no-unreachable
			const lowUsage = common.nodes.lowUsage()
			return lowUsage.find(node => node.regions.includes(region)) || lowUsage[0]
		}
	},

	invidious: {
		/**
		 * Get the Invidious origin that should be used with a specific Lavalink node.
		 * @param {string} host
		 * @returns {string}
		 */
		getOrigin: function(host) {
			const node = common.nodes.getByHost(host)
			return node.invidious_origin
		},

		/**
		 * Return a request promise. This is chained to reject if data.error is set.
		 * @param {string} id
		 * @param {string} [host] host of lavalink node that will be used with this data
		 */
		getData: function(id, host = null) {
			return fetch(`${common.invidious.getOrigin(host)}/api/v1/videos/${id}`).then(async data => {
				const json = await data.json()
				if (json.error) throw new Error(json.error)
				else return json
			})
		},

		/**
		 * @param {string} input
		 * @param {string} host
		 * @returns {Promise<{type: string, title: string, videoId: string, author: string, lengthSeconds: number, liveNow: boolean}[]>}
		 */
		search: function(input, host) {
			const url = new URL(`${common.invidious.getOrigin(host)}/api/v1/search`)
			url.searchParams.append("q", input)
			url.searchParams.append("type", input)
			return fetch(url.toString()).then(async data => {
				const json = await data.json()
				if (json.error) throw new Error(json.error)
				else return json
			})
		},

		/**
		 * @param {{type: string, title: string, videoId: string, author: string, lengthSeconds: number, liveNow: boolean}[]} results
		 */
		searchResultsToTracks: function(results) {
			try {
				return results.filter(result => result.type === "video").map(result => ({
					track: encode({
						flags: 1,
						version: 2,
						title: result.title,
						author: result.author,
						length: BigInt(result.lengthSeconds) * BigInt(1000),
						identifier: result.videoId,
						isStream: result.liveNow, // this is a guess
						uri: `https://www.youtube.com/watch?v=${result.videoId}`,
						source: "youtube",
						position: BigInt(0)
					}),
					info: {
						identifier: result.videoId,
						isSeekable: true,
						author: result.author,
						length: result.lengthSeconds * 1000,
						isStream: result.liveNow,
						position: 0,
						title: result.title,
						uri: `https://www.youtube.com/watch?v=${result.videoId}`
					}
				}))
			} catch {
				return []
			}
		},

		/**
		 * @param {string} id
		 * @param {number} [pageNumber] 1-indexed
		 * @param {string} [host] host of lavalink node that will be used with this data
		 * @returns {Promise<import("../../typings").InvidiousPlaylist>}
		 */
		getPlaylistPage: function(id, pageNumber = 1, host = null) {
			return fetch(`${common.invidious.getOrigin(host)}/api/v1/playlists/${id}?page=${pageNumber}`).then(res => res.json())
		},

		/**
		 * @param {string} id
		 */
		getPlaylist: function(id) {
			const pageSize = 100 // max number of videos returned in a page, magic number
			/** @type {import("../../typings").InvidiousPlaylistVideo[]} */
			let videos = []

			return common.invidious.getPlaylistPage(id).then(async root => {
				videos = videos.concat(root.videos)
				if (root.videoCount > pageSize) {
					const additionalResponses = await Promise.all(
						Array(Math.ceil(root.videoCount / pageSize) - 1).fill(undefined).map((_, page) => {
							return common.invidious.getPlaylistPage(id, page + 2)
						})
					)
					for (const response of additionalResponses) {
						videos = videos.concat(response.videos)
					}
				}
				return videos
			})
		},

		/**
		 * Find the best audio stream URL in a data object. Throw if the data is bad.
		 * @param {{ adaptiveFormats: Array<{ type: string, bitrate: string, url: string }> }} data
		 */
		dataToURL: function(data) {
			let formats = data && data.adaptiveFormats
			if (!formats || !formats[0]) throw new Error("This video has probably been deleted. (Invidious returned no formats.)")
			formats = formats
				.filter(f => f.type.includes("audio"))
				.sort((a, b) => {
					const abitrate = Number(a.bitrate) + (a.type.includes("audio/webm") ? 20000 : 0)
					const bbitrate = Number(b.bitrate) + (b.type.includes("audio/webm") ? 20000 : 0)
					return bbitrate - abitrate
				})
			if (formats[0]) return formats[0].url
			throw new Error("Invidious did not return any audio formats. Sadly, we cannot play this song.")
		},

		/**
		 * Promise to get the track. Errors are rejected.
		 * @param {string} url
		 */
		urlToTrack: function(url, region = "") {
			if (!url) throw new Error("url parameter in urlToTrack is falsy")
			return common.getTracks(url, region).then(tracks => {
				if (!tracks || !tracks[0]) {
					console.error("Missing tracks from getTracks response")
					console.error(tracks)
					throw new Error("Missing tracks from getTracks response")
				} else {
					return tracks[0].track
				}
			})
		},

		/**
		 * Promise to get data to URL to track. Errors produced anywhere in the chain are rejected.
		 * @param {string} id
		 * @param {string} [host] host of lavalink node that will be used with this data
		 * @param {string} [region] region of lavalink node that will be used with this data
		 * @returns {Promise<string>}
		 */
		getTrack: function(id, host = null, region = null) {
			return common.invidious.getData(id, host)
				.then(common.invidious.dataToURL)
				.then(url => common.invidious.urlToTrack(url, region))
		}
	},

	inserters: {
		handleSong:
		/**
		 * @param {import("./songtypes").Song} song
		 * @param {Discord.Message["channel"]} textChannel
		 * @param {Discord.VoiceChannel} voiceChannel
		 * @param {boolean} insert
		 * @param {Discord.Message} [context]
		 */
		async function(song, textChannel, voiceChannel, insert, context) {
			const queue = await passthrough.queues.getOrCreate(voiceChannel, textChannel)
			const result = queue.addSong(song, insert)
			if (context instanceof Discord.Message && result == 0) {
				context.react("✅")
			}
		},

		fromData:
		/**
		 * @param {Discord.Message["channel"]} textChannel
		 * @param {Discord.VoiceChannel} voiceChannel
		 * @param {any} data
		 * @param {boolean} insert
		 * @param {Discord.Message} [context]
		 */
		function(textChannel, voiceChannel, data, insert, context) {
			const songTypes = require("./songtypes")
			const song = songTypes.makeYouTubeSongFromData(data)
			common.inserters.handleSong(song, textChannel, voiceChannel, insert, context)
		},

		fromDataArray:
		/**
		 * @param {Discord.Message["channel"]} textChannel
		 * @param {Discord.VoiceChannel} voiceChannel
		 * @param {any[]} data
		 * @param {boolean} insert
		 * @param {Discord.Message} [context]
		 */
		function(textChannel, voiceChannel, data, insert, context) {
			const songTypes = require("./songtypes")
			const songs = data.map(item => songTypes.makeYouTubeSongFromData(item))
			common.inserters.fromSongArray(textChannel, voiceChannel, songs, insert, context)
		},

		fromSongArray:
		/**
		 * @param {Discord.Message["channel"]} textChannel
		 * @param {Discord.VoiceChannel} voiceChannel
		 * @param {any[]} songs
		 * @param {boolean} insert
		 * @param {Discord.Message} [context]
		 */
		async function(textChannel, voiceChannel, songs, insert, context) {
			if (insert) songs.reverse()
			const queue = await passthrough.queues.getOrCreate(voiceChannel, textChannel)
			const results = songs.map(song => {
				return queue.addSong(song, insert)
			})
			if (context instanceof Discord.Message && results[0] === 0) {
				context.react("✅")
			}
		},

		fromSearch:
		/**
		 * @param {Discord.Message["channel"]} textChannel
		 * @param {Discord.VoiceChannel} voiceChannel
		 * @param {Discord.User} author
		 * @param {boolean} insert
		 * @param {string} search
		 * @param {import("@amanda/lang").Lang} lang
		 */
		async function(textChannel, voiceChannel, author, insert, search, lang) {
			let tracks = await common.searchYouTube(search, textChannel.guild.region)
			if (tracks.length == 0) return textChannel.send(lang.audio.music.prompts.noResults)
			tracks = tracks.slice(0, 10)
			const results = tracks.map((track, index) => `${index + 1}. **${Util.escapeMarkdown(track.info.title)}** (${common.prettySeconds(track.info.length / 1000)})`)
			utils.makeSelection(textChannel, author.id, lang.audio.music.prompts.songSelection, lang.audio.music.prompts.songSelectionCanceled, results).then(index => {
				if (typeof index != "number") return
				const track = tracks[index]
				if (config.use_invidious) {
					const song = new (require("./songtypes").YouTubeSong)(track.info.identifier, track.info.title, Math.floor(track.info.length / 1000), null, track.info.author)
					common.inserters.handleSong(song, textChannel, voiceChannel, insert)
				} else {
					common.inserters.fromData(textChannel, voiceChannel, track, insert)
				}
			})
		},

		fromSoundCloudSearch:
		/**
		 * @param {Discord.Message["channel"]} textChannel
		 * @param {Discord.VoiceChannel} voiceChannel
		 * @param {Discord.User} author
		 * @param {boolean} insert
		 * @param {string} search
		 * @param {import("@amanda/lang").Lang} lang
		 */
		async function(textChannel, voiceChannel, author, insert, search, lang) {
			let tracks
			try {
				tracks = await common.getTracks(`scsearch:${search}`, textChannel.guild.region)
			} catch {
				return textChannel.send(lang.audio.music.prompts.noResults)
			}
			if (tracks.length == 0) return textChannel.send(lang.audio.music.prompts.noResults)
			tracks = tracks.slice(0, 10)
			const results = tracks.map((track, index) => `${index + 1}. **${Util.escapeMarkdown(track.info.title)}** (${common.prettySeconds(Math.floor(track.info.length / 1000))})`)
			utils.makeSelection(textChannel, author.id, lang.audio.music.prompts.songSelection, lang.audio.music.prompts.songSelectionCanceled, results).then(index => {
				if (typeof index != "number") return
				const track = tracks[index]
				const song = new (require("./songtypes").SoundCloudSong)(track.info, track.track)
				common.inserters.handleSong(song, textChannel, voiceChannel, insert)
			})
		},

		fromSoundCloudLink:
		/**
		 * @param {Discord.Message["channel"]} textChannel
		 * @param {Discord.VoiceChannel} voiceChannel
		 * @param {Discord.Message} msg
		 * @param {boolean} insert
		 * @param {string} link
		 * @param {import("@amanda/lang").Lang} lang
		 */
		async function(textChannel, voiceChannel, msg, insert, link, lang) {
			let tracks
			try {
				tracks = await common.getTracks(link, textChannel.guild.region)
			} catch {
				return textChannel.send(utils.replace(lang.audio.music.prompts.invalidLink, { username: msg.author.username }))
			}
			if (tracks && tracks[0]) {
				const track = tracks[0]
				const song = new (require("./songtypes").SoundCloudSong)(track.info, track.track)
				common.inserters.handleSong(song, textChannel, voiceChannel, insert, msg)
			} else {
				textChannel.send(utils.replace(lang.audio.music.prompts.invalidLink, { username: msg.author.username }))
			}
		},
		fromSpotifyLink:
		/**
		 * @param {Discord.Message["channel"]} textChannel
		 * @param {Discord.VoiceChannel} voiceChannel
		 * @param {Discord.Message} msg
		 * @param {boolean} insert
		 * @param {string} link
		 * @param {import("@amanda/lang").Lang} lang
		 */
		async function(textChannel, voiceChannel, msg, insert, link, lang) {
			const songtypes = require("./songtypes")
			let data
			try {
				data = await common.spotify.search(link)
			} catch (e) {
				console.error(e)
				return textChannel.send(utils.replace(lang.audio.music.prompts.invalidLink, { username: msg.author.username }))
			}
			const tracks = common.spotify.getTrackInfo(data)
			const songs = tracks.map(track => songtypes.makeSpotifySong(track))
			return common.inserters.fromSongArray(textChannel, voiceChannel, songs, insert, msg)
		}
	},

	voiceStateCallbackManager: {
		/**
		 * @type {VoiceStateCallback[]}
		 */
		callbacks: [],
		/**
		 * @param {string} userID
		 * @param {string} guildID
		 * @returns {VoiceStateCallback[]}
		 */
		getAll: function(userID, guildID) {
			return this.callbacks.filter(o => o.msg.author.id == userID && o.guildID === guildID)
		}
	},

	spotify: {
		/**
		 * @param {string} url
		 * @returns {Promise<import("../../typings").SpotifyTrack | import("../../typings").SpotifyPlaylist>}
		 */
		search: async function(url) {
			let text
			// eslint-disable-next-line no-useless-catch
			try {
				text = await fetch(url).then(res => res.text())
			} catch (e) {
				throw e
			}
			const ss = "Spotify.Entity"
			const start = text.indexOf(ss)
			const afterStart = text.substring(start)
			const end = afterStart.indexOf(";")
			const body = text.slice(start + ss.length + 3, start + end)
			if (!body) throw new Error("Cannot extract Spotify track info")
			let parsed
			// eslint-disable-next-line no-useless-catch
			try {
				parsed = JSON.parse(body)
			} catch {
				throw new Error("Cannot extract Spotify track info")
			}
			return parsed
		},
		/**
		 * @param {import("../../typings").SpotifyTrack | import("../../typings").SpotifyPlaylist} data
		 */
		getTrackInfo(data) {
			if (data.type == "track") {
				return [data]
			} else if (data.type == "playlist") {
				return data.tracks.items.map(d => d.track)
			}
		}
	},

	VoiceStateCallback,

	/**
	 * @param {Discord.Message} msg
	 * @param {number} timeoutMs
	 * @returns {Promise<Discord.VoiceChannel>}
	 */
	getPromiseVoiceStateCallback: function(msg, timeoutMs) {
		return new Promise(resolve => {
			new common.VoiceStateCallback(msg, timeoutMs, voiceChannel => resolve(voiceChannel))
		})
	},

	/**
	 * Find the member that sent a message and get their voice channel.
	 * If `wait` is set, then wait 30 seconds for them to connect.
	 * Returns a promise that eventually resolves to a voice channel, or null (if they didn't join in time)
	 * **This responds to the user on failure, and also checks if the client has permission to join and speak.**
	 * @param {Discord.Message} msg
	 * @param {boolean} wait If false, return immediately. If true, wait up to 30 seconds for the member to connect.
	 * @param {import("@amanda/lang").Lang} lang
	 * @returns {Promise<(Discord.VoiceChannel|null)>}
	 */
	detectVoiceChannel: async function(msg, wait, lang) {
		// Already in a voice channel? Use that!
		const state = await client.rain.cache.voiceState.get(msg.author.id, msg.guild.id)
		if (state) {
			const cdata = await utils.cacheManager.channels.get(state.channel_id, true, true)
			return common.verifyVoiceChannel(cdata, msg, lang)
		}
		// Not in a voice channel, and not waiting? Quit.
		if (!wait) {
			msg.channel.send(utils.replace(lang.audio.music.prompts.voiceChannelRequired, { "username": msg.author.username }))
			return null
		}
		// Tell the user to join.
		const prompt = await msg.channel.send(utils.replace(lang.audio.music.prompts.voiceChannelWaiting, { "username": msg.author.username }))
		// Return a promise which waits for them.
		return common.getPromiseVoiceStateCallback(msg, 30000).then(voiceChannel => {
			if (voiceChannel) {
				prompt.delete()
				return voiceChannel
			} else {
				prompt.edit(utils.replace(lang.audio.music.prompts.voiceChannelRequired, { "username": msg.author.username }))
				return null
			}
		})
	},

	/**
	 * Checks if the client can join and speak in the voice channel.
	 * If it can, return the voice channel.
	 * If it can't, send an error in chat and return null.
	 * @param {Discord.VoiceChannel} voiceChannel Voice channel to check
	 * @param {Discord.Message} msg Message to direct errors at
	 * @param {import("@amanda/lang").Lang} lang
	 * @return {(Discord.VoiceChannel|null)}
	 */
	verifyVoiceChannel: async function(voiceChannel, msg, lang) {
		const perms = await utils.cacheManager.channels.permissionsFor({ id: voiceChannel.id })
		const viewable = await utils.cacheManager.channels.hasPermissions({ id: voiceChannel.id, guild_id: voiceChannel.guild.id }, "VIEW_CHANNEL", perms)
		const joinable = await utils.cacheManager.channels.hasPermissions({ id: voiceChannel.id, guild_id: voiceChannel.guild.id }, "CONNECT", perms)
		const speakable = await utils.cacheManager.channels.hasPermissions({ id: voiceChannel.id, guild_id: voiceChannel.guild.id }, "SPEAK", perms)
		if ((!viewable && !joinable)) {
			msg.channel.send(utils.replace(lang.audio.music.prompts.voiceCantJoin, { "username": msg.author.username }))
			return null
		}
		if (!speakable) {
			msg.channel.send(utils.replace(lang.audio.music.prompts.voiceCantSpeak, { "username": msg.author.username }))
			return null
		}
		// All good!
		return voiceChannel
	},
	/**
	 * @param {Discord.VoiceState} state
	 */
	voiceStateUpdate: async function(state) {
		if (state.id === client.user.id) return
		if (!state.guildID) return // we should only process voice state updates that are in guilds
		const queues = passthrough.queues
		const queue = queues.cache.get(state.guildID)

		// Process waiting to join
		// If someone else changed state, and their new state has a channel (i.e. just joined or switched channel)
		if (state.channelID) {
			const mdata = await utils.cacheManager.members.get(state.id, state.guildID, true, true)
			if (mdata) {
				if (queue) queue.listeners.set(state.id, mdata)
			}
			const vc = await utils.cacheManager.channels.get(state.channelID, true, true)
			// Trigger all callbacks for that user in that guild
			common.voiceStateCallbackManager.getAll(state.id, state.guildID).forEach(s => s.trigger(vc))
		} else {
			if (queue) queue.listeners.delete(state.id)
		}

		if (queue) queue.voiceStateUpdate(state)
	}
}

utils.addTemporaryListener(client, "voiceStateUpdate", path.basename(__filename), common.voiceStateUpdate)

module.exports = common
