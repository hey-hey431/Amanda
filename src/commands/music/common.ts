/* eslint-disable no-useless-catch */
// @ts-check

import fetch from "node-fetch"
const Discord: typeof import("thunderstorm") = require("thunderstorm")
import path from "path"
import { encode } from "@lavalink/encoding"
// @ts-ignore
import genius from "genius-lyrics-api"
import entities from "entities"

import passthrough from "../../passthrough"
const { client, reloader, config, constants } = passthrough

import utils from "../../modules/utilities"
reloader.sync("./modules/utilities/index.js", utils)

const vscbs: Array<any> = []

class VoiceStateCallback {
	msg: import("thunderstorm").Message
	guildID: string
	timeout: NodeJS.Timeout
	callback: (voiceChannel: import("thunderstorm").VoiceChannel | null) => any
	active: boolean

	constructor(msg: import("thunderstorm").Message, timeoutMs: number, callback: (voiceChannel: import("thunderstorm").VoiceChannel | null) => any) {
		this.msg = msg
		this.guildID = msg.guild!.id
		this.timeout = setTimeout(() => this.cancel(), timeoutMs)
		this.callback = callback
		this.active = true
		common.voiceStateCallbackManager.getAll(this.msg.author.id, this.msg.guild!.id).forEach(o => o.cancel()) // this works? (common declared later)
		this.add()
	}
	add() {
		common.voiceStateCallbackManager.callbacks.push(this)
	}
	remove() {
		const index = common.voiceStateCallbackManager.callbacks.indexOf(this)
		if (index != -1) common.voiceStateCallbackManager.callbacks.splice(index, 1)
	}
	async trigger(voiceChannel: import("thunderstorm").VoiceChannel) {
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
	prettySeconds: function(seconds: number) {
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

	inputToID: function(input: string): ({ type: string; id?: string; list?: string; link?: string }) | null {
		input = input.replace(/(^<|>$)/g, "")
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
			} else if (url.hostname == "newgrounds.com" && url.pathname.startsWith("/audio/listen")) {
				return { type: "newgrounds", link: url.toString() }
			} else if (url.hostname == "cadence.moe" || url.hostname == "cadence.gq") { // Is it CloudTube?
				try {
					const match = url.pathname.match(/video\/([\w-]{11})$/)
					let id
					if (match) id = match[1]
					else throw new Error("No ID match")
					// Got an ID!
					return { type: "video", id: id }
				} catch (e) {
					// Didn't match.
					return null
				}
			} else if (url.hostname == "youtu.be") { // Is it youtu.be?
				const id = url.pathname.slice(1)
				return { type: "video", id: id }
			} else if (url.hostname == "youtube.com" || url.hostname == "invidio.us" || url.hostname == "hooktube.com" || url.hostname === "m.youtube.com") { // Is it YouTube-compatible?
				// Is it a playlist?
				if (url.searchParams.get("list")) {
					const result: { type: string, list: string | undefined, id?: string } = { type: "playlist", list: url.searchParams.get("list") || undefined }
					const id = url.searchParams.get("v")
					if (id) result.id = id
					return result
				} else if (url.pathname == "/watch") { // Is it a video?
					const id = url.searchParams.get("v") || undefined
					// Got an ID!
					return { type: "video", id: id }
				} else return null // YouTube-compatible, but can't resolve to a video.
			} else return { type: "external", link: url.toString() } // Possibly a link to an audio file
		} catch (e) {
			// Not a URL. Might be an ID?
			if (input.match(/^[A-Za-z0-9_-]{11}$/)) return { type: "video", id: input }
			else return null
		}
	},

	/**
	 * Call /loadtracks on the first node using the passed identifier.
	 * Throws exception.message.
	 */
	getTracks: async function(input: string, region = ""): Promise<Array<{ track: string; info: import("../../typings").LavalinkInfo }>> {
		const node = common.nodes.getByRegion(region)

		const params = new URLSearchParams()
		params.append("identifier", input)

		const data = await fetch(`http://${node.host}:${node.port}/loadtracks?${params.toString()}`, {
			headers: {
				"Authorization": node.password
			}
		})
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
	},

	searchYouTube: async function(input: string, region = "") {
		const node = common.nodes.getByRegion(region)
		if (node.search_with_invidious) {
			let d
			try {
				d = await common.invidious.search(input, node.host).then(common.invidious.searchResultsToTracks)
			} catch {
				return Promise.resolve([])
			}
			return d
		} else {
			return common.getTracks(`ytsearch:${input}`, region)
		}
	},

	genius: {
		getLyrics: function(title: string, artist: string | undefined = undefined): Promise<string | null> {
			const options = {
				apiKey: config.genius_access_token,
				title: title,
				artist: artist,
				optimizeQuery: true
			}
			return genius.getLyrics(options)
		},

		pickApart(song: import("./songtypes").Song) {
			const songTypes = require("./songtypes")

			const expressions = [
				/([^|[\]]+?) ?(?:[-–—]|\bby\b) ?([^()[\],]+)?/, // (Toni Romiti) - (Switch Up )\(Ft. Big Rod\) | Non escaped () means cap group
				/([^-]+) - Topic/ // If the artist is officially uploaded by YouTube. Sucks to suck if they have a - in their name
			]

			let title = "", artist = ""

			const standard = () => {
				const match = song.title.match(expressions[0])
				if (match) {
					title = match[2]
					artist = match[1]
				}
				if (!title || !artist) {
					if (song instanceof songTypes.YouTubeSong) {
						title = song.title
						// @ts-ignore
						artist = song.uploader
					}
				}
			}

			if (song instanceof songTypes.SpotifySong || song instanceof songTypes.SoundCloudSong) {
				title = song.title
				// @ts-ignore
				artist = song.artist
			} else if (song instanceof songTypes.YouTubeSong) {
				// @ts-ignore
				if (song.uploader) {
					// @ts-ignore
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
			return client.lavalink.idealNodes.map(node => constants.lavalinkNodes.find(n => n.host === node.host)).filter(node => node && node.enabled)
		},

		first() {
			return constants.lavalinkNodes.find(n => n.enabled) || constants.lavalinkNodes[0]
		},

		getByHost(host?: string) {
			return constants.lavalinkNodes.find(n => n.enabled && n.host === host) || common.nodes.first()
		},

		getByID(id: string) {
			return constants.lavalinkNodes.find(n => n.enabled && n.id == id) || common.nodes.first()
		},

		getByRegion(region: string) {
			return constants.lavalinkNodes.find(n => n.enabled && n.regions.includes(region)) || common.nodes.first()
			// const lowUsage = common.nodes.lowUsage()
			// return lowUsage.find(node => node.regions.includes(region)) || lowUsage[0]
		}
	},

	invidious: {
		/**
		 * Get the Invidious origin that should be used with a specific Lavalink node.
		 */
		getOrigin: function(host?: string) {
			const node = common.nodes.getByHost(host)
			return node.invidious_origin
		},

		/**
		 * Return a request promise. This is chained to reject if data.error is set.
		 */
		getData: async function(id: string, host?: string) {
			const data = await fetch(`${common.invidious.getOrigin(host)}/api/v1/videos/${id}`)
			const json = await data.json()
			if (json.error) throw new Error(json.error)
			else return json
		},

		search: async function(input: string, host: string): Promise<{ type: string; title: string; videoId: string; author: string; lengthSeconds: number; liveNow: boolean }[]> {
			const url = new URL(`${common.invidious.getOrigin(host)}/api/v1/search`)
			url.searchParams.append("q", input)
			url.searchParams.append("type", input)
			const data = await fetch(url.toString())
			const json = await data.json()
			if (json.error) throw new Error(json.error)
			else return json
		},

		searchResultsToTracks: function(results: { type: string; title: string; videoId: string; author: string; lengthSeconds: number; liveNow: boolean }[]) {
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

		getPlaylistPage: async function(id: string, pageNumber = 1, host?: string): Promise<import("../../typings").InvidiousPlaylist> {
			const res = await fetch(`${common.invidious.getOrigin(host)}/api/v1/playlists/${id}?page=${pageNumber}`)
			return res.json()
		},

		getPlaylist: async function(id: string) {
			const pageSize = 100 // max number of videos returned in a page, magic number
			let videos: import("../../typings").InvidiousPlaylistVideo[] = []

			const root = await common.invidious.getPlaylistPage(id)
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
		},

		/**
		 * Find the best audio stream URL in a data object. Throw if the data is bad.
		 */
		dataToURL: function(data: { adaptiveFormats: Array<{ type: string; bitrate: string; url: string }> }) {
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
		urlToTrack: async function(url: string, region = "") {
			if (!url) throw new Error("url parameter in urlToTrack is falsy")
			const tracks = await common.getTracks(url, region)
			if (!tracks || !tracks[0]) {
				console.error("Missing tracks from getTracks response")
				console.error(tracks)
				throw new Error("Missing tracks from getTracks response")
			} else {
				return tracks[0].track
			}
		},

		/**
		 * Promise to get data to URL to track. Errors produced anywhere in the chain are rejected.
		 */
		getTrack: function(id: string, host?: string, region?: string): Promise<string> {
			return common.invidious.getData(id, host)
				.then(common.invidious.dataToURL)
				.then(url => common.invidious.urlToTrack(url, region))
		}
	},

	inserters: {
		handleSong: async function(song: import("./songtypes").Song, textChannel: import("thunderstorm").PartialChannel, voiceChannel: import("thunderstorm").VoiceChannel, insert: boolean, context?: import("thunderstorm").Message) {
			const queue = await passthrough.queues.getOrCreate(voiceChannel, textChannel)
			const result = queue.addSong(song, insert)
			if (context instanceof Discord.Message && result == 0) {
				context.react("✅")
			}
		},

		fromData: function(textChannel: import("thunderstorm").PartialChannel, voiceChannel: import("thunderstorm").VoiceChannel, data: any, insert: boolean, context?: import("thunderstorm").Message) {
			const songTypes = require("./songtypes")
			const song = songTypes.makeYouTubeSongFromData(data)
			common.inserters.handleSong(song, textChannel, voiceChannel, insert, context)
		},

		fromDataArray: function(textChannel: import("thunderstorm").PartialChannel, voiceChannel: import("thunderstorm").VoiceChannel, data: any[], insert: boolean, context?: import("thunderstorm").Message) {
			const songTypes = require("./songtypes")
			const songs = data.map(item => songTypes.makeYouTubeSongFromData(item))
			common.inserters.fromSongArray(textChannel, voiceChannel, songs, insert, context)
		},

		fromSongArray: async function(textChannel: import("thunderstorm").PartialChannel, voiceChannel: import("thunderstorm").VoiceChannel, songs: any[], insert: boolean, context?: import("thunderstorm").Message) {
			if (insert) songs.reverse()
			const queue = await passthrough.queues.getOrCreate(voiceChannel, textChannel)
			const results = songs.map(song => {
				return queue.addSong(song, insert)
			})
			if (context instanceof Discord.Message && results[0] === 0) {
				context.react("✅")
			}
		},

		fromSearch: async function(textChannel: import("thunderstorm").PartialChannel, voiceChannel: import("thunderstorm").VoiceChannel, author: import("thunderstorm").User, insert: boolean, search: string, lang: import("@amanda/lang").Lang) {
			const g = await utils.cacheManager.guilds.get(voiceChannel.guild.id, true, true)
			// @ts-ignore
			let tracks = await common.searchYouTube(search, g ? g.region : undefined)
			if (tracks.length == 0) return textChannel.send(lang.audio.music.prompts.noResults)
			tracks = tracks.slice(0, 10)
			const results = tracks.map((track, index) => `${index + 1}. **${Discord.Util.escapeMarkdown(track.info.title)}** (${common.prettySeconds(track.info.length / 1000)})`)
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

		fromSoundCloudSearch: async function(textChannel: import("thunderstorm").PartialChannel, voiceChannel: import("thunderstorm").VoiceChannel, author: import("thunderstorm").User, insert: boolean, search: string, lang: import("@amanda/lang").Lang) {
			const g = await utils.cacheManager.guilds.get(voiceChannel.guild.id, true, true)
			let tracks: Array<{ track: string, info: import("../../typings/index").LavalinkInfo }>
			try {
				// @ts-ignore
				tracks = await common.getTracks(`scsearch:${search}`, g.region)
			} catch {
				return textChannel.send(lang.audio.music.prompts.noResults)
			}
			if (tracks.length == 0) return textChannel.send(lang.audio.music.prompts.noResults)
			tracks = tracks.slice(0, 10)
			const results = tracks.map((track, index) => `${index + 1}. **${Discord.Util.escapeMarkdown(track.info.title)}** (${common.prettySeconds(Math.floor(track.info.length / 1000))})`)
			utils.makeSelection(textChannel, author.id, lang.audio.music.prompts.songSelection, lang.audio.music.prompts.songSelectionCanceled, results).then(index => {
				if (typeof index != "number") return
				const track = tracks[index]
				const song = new (require("./songtypes").SoundCloudSong)(track.info, track.track)
				common.inserters.handleSong(song, textChannel, voiceChannel, insert)
			})
		},

		fromSoundCloudLink: async function(textChannel: import("thunderstorm").PartialChannel, voiceChannel: import("thunderstorm").VoiceChannel, msg: import("thunderstorm").Message, insert: boolean, link: string, lang: import("@amanda/lang").Lang) {
			const g = await utils.cacheManager.guilds.get(voiceChannel.guild.id, true, true)
			let tracks
			try {
				// @ts-ignore
				tracks = await common.getTracks(link, g.region)
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

		fromSpotifyLink: async function(textChannel: import("thunderstorm").PartialChannel, voiceChannel: import("thunderstorm").VoiceChannel, msg: import("thunderstorm").Message, insert: boolean, link: string, lang: import("@amanda/lang").Lang) {
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
		},

		fromExternalLink: async function(textChannel: import("thunderstorm").PartialChannel, voiceChannel: import("thunderstorm").VoiceChannel, msg: import("thunderstorm").Message, insert: boolean, link: string, lang: import("@amanda/lang").Lang) {
			const songtypes = require("./songtypes")
			let data
			try {
				data = await fetch(link, { method: "HEAD" })
			} catch {
				return textChannel.send(utils.replace(lang.audio.music.prompts.invalidLink, { username: msg.author.username }))
			}
			const mime = data.headers.get("content-type") || data.headers.get("Content-Type")
			if (!mime || !mime.startsWith("audio/")) return textChannel.send(utils.replace(lang.audio.music.prompts.invalidLink, { username: msg.author.username }))
			const song = songtypes.makeExternalSong(link)
			return common.inserters.handleSong(song, textChannel, voiceChannel, insert, msg)
		},

		fromNewgroundsSearch: async function(textChannel: import("thunderstorm").PartialChannel, voiceChannel: import("thunderstorm").VoiceChannel, author: import("thunderstorm").User, insert: boolean, search: string, lang: import("@amanda/lang").Lang) {
			let tracks: Array<{ href: string, image: string, title: string, author: string }>
			try {
				tracks = await common.newgrounds.search(search)
			} catch {
				return textChannel.send(lang.audio.music.prompts.noResults)
			}
			if (tracks.length == 0) return textChannel.send(lang.audio.music.prompts.noResults)
			tracks = tracks.slice(0, 10)
			const results = tracks.map((track, index) => `${index + 1}. **${Discord.Util.escapeMarkdown(`${track.author} - ${track.title}`)}**`)
			utils.makeSelection(textChannel, author.id, lang.audio.music.prompts.songSelection, lang.audio.music.prompts.songSelectionCanceled, results).then(async index => {
				if (typeof index != "number") return
				const track = tracks[index]
				const data = await common.newgrounds.getData(track.href)
				const song = require("./songtypes").makeNewgroundsSong(data)
				common.inserters.handleSong(song, textChannel, voiceChannel, insert)
			})
		},

		fromNewgroundsLink: async function(textChannel: import("thunderstorm").PartialChannel, voiceChannel: import("thunderstorm").VoiceChannel, msg: import("thunderstorm").Message, insert: boolean, link: string, lang: import("@amanda/lang").Lang) {
			const songtypes = require("./songtypes")
			let data
			try {
				data = await common.newgrounds.getData(link)
			} catch (e) {
				console.error(e)
				return textChannel.send(utils.replace(lang.audio.music.prompts.invalidLink, { username: msg.author.username }))
			}
			const song = songtypes.makeNewgroundsSong(data)
			return common.inserters.handleSong(song, textChannel, voiceChannel, insert, msg)
		}
	},

	voiceStateCallbackManager: {
		callbacks: vscbs,
		getAll: function(userID: string, guildID: string): VoiceStateCallback[] {
			return this.callbacks.filter(o => o.msg.author.id == userID && o.guildID === guildID)
		}
	},

	spotify: {
		search: async function(url: string): Promise<import("../../typings").SpotifyTrack | import("../../typings").SpotifyPlaylist> {
			let text
			try {
				text = await fetch(url).then(res => res.text())
			} catch (e) {
				console.error(e)
				throw e
			}
			const ss = "Spotify.Entity"
			const start = text.indexOf(ss)
			const afterStart = text.substring(start)
			const end = afterStart.indexOf(";")
			const body = text.slice(start + ss.length + 3, start + end)
			if (!body) throw new Error("Cannot extract Spotify track info")
			let parsed
			try {
				parsed = JSON.parse(body)
			} catch {
				throw new Error("Cannot extract Spotify track info")
			}
			return parsed
		},

		getTrackInfo(data: import("../../typings").SpotifyTrack | import("../../typings").SpotifyPlaylist) {
			if (data.type == "playlist") {
				return data.tracks.items.map(d => d.track)
			} else {
				return [data]
			}
		}
	},

	newgrounds: {
		search: async function(text: string) {
			let html
			try {
				html = await fetch(`https://newgrounds.com/search/conduct/audio?suitables=etm&c=3&terms=${encodeURIComponent(text)}`).then(res => res.text())
			} catch(e) {
				console.error(e)
				throw e
			}
			const ss = "<ul class=\"itemlist spaced\">"
			const start = html.indexOf(ss)
			const afterStart = html.substring(start)
			const end = afterStart.indexOf("</ul>")
			let results = afterStart.slice(ss.length, end).trim()

			const parsed = []

			let passing = true
			while (passing) {
				if (!results.includes("<li>")) {
					passing = false
					continue
				}
				const li = results.slice(0, results.indexOf("</li>"))

				// Get the link to the list entry
				const hrefStart = li.indexOf("<a href=")
				const hrefAfter = li.substring("<a href=".length + 1 + hrefStart)
				const hrefEnd = hrefAfter.indexOf("\"")
				const href = hrefAfter.slice(0, hrefEnd)

				// Get the icon of the list entry
				const imgStart = li.indexOf("<img src=")
				const imgAfter = li.substring("<img src=".length + 1 + imgStart)
				const imgEnd = imgAfter.indexOf("\"")
				const image = imgAfter.slice(0, imgEnd)

				// Get the title of the list entry
				const titleStart = li.indexOf("<h4>")
				const titleAfter = li.substring("<h4>".length + titleStart)
				const titleEnd = titleAfter.indexOf("</h4>")
				const title = titleAfter.slice(0, titleEnd)
					.replace(/<mark class="search-highlight">/g, "")
					.replace(/<\/mark>/g, "")
					.trim()

				// Get the author of the list entry
				const authorStart = li.indexOf("<strong>")
				const authorAfter = li.substring("<strong>".length + authorStart)
				const authorEnd = authorAfter.indexOf("</strong>")
				const author = authorAfter.slice(0, authorEnd)

				const meta = { href: href, image: image, title: entities.decodeHTML(title), author: author }

				parsed.push(meta)

				results = results.substring(li.length + 5).trim()
			}

			return parsed
		},

		getData: async function(link: string) {
			const match = link.match(/https:\/\/(?:www\.)?newgrounds\.com\/audio\/listen\/([\d\w]+)/)
			if (!match) throw new Error("Not a valid newgrounds link")
			const ID = match[1]
			let data
			try {
				data = await fetch(`https://newgrounds.com/audio/load/${ID}/3`, { method: "GET", headers: { "x-requested-with": "XMLHttpRequest" } }).then(d => d.json())
			} catch {
				throw new Error("Cannot extract NewGrounds track info")
			}
			return { id: data.id, href: data.url, title: data.title, author: data.author, duration: data.duration, mp3URL: data.sources[0].src }
		}
	},

	VoiceStateCallback,

	getPromiseVoiceStateCallback: function(msg: import("thunderstorm").Message, timeoutMs: number): Promise<import("thunderstorm").VoiceChannel | null> {
		return new Promise(resolve => {
			new common.VoiceStateCallback(msg, timeoutMs, voiceChannel => resolve(voiceChannel))
		})
	},

	/**
	 * Find the member that sent a message and get their voice channel.
	 * If `wait` is set, then wait 30 seconds for them to connect.
	 * Returns a promise that eventually resolves to a voice channel, or null (if they didn't join in time)
	 * **This responds to the user on failure, and also checks if the client has permission to join and speak.**
	 */
	detectVoiceChannel: async function(msg: import("thunderstorm").Message, wait: boolean, lang: import("@amanda/lang").Lang): Promise<(import("thunderstorm").VoiceChannel | null)> {
		// Already in a voice channel? Use that!
		const state = await client.rain.cache.voiceState.get(msg.author.id, msg.guild!.id)
		if (state) {
			/** @type {import("thunderstorm").VoiceChannel} */
			// @ts-ignore
			const cdata = await utils.cacheManager.channels.get(state.channel_id, true, true)
			// @ts-ignore
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
	 */
	verifyVoiceChannel: async function(voiceChannel: import("thunderstorm").VoiceChannel, msg: import("thunderstorm").Message, lang: import("@amanda/lang").Lang): Promise<(import("thunderstorm").VoiceChannel | null)> {
		const perms = await utils.cacheManager.channels.permissionsFor({ id: voiceChannel.id, guild_id: voiceChannel.guild.id })
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
	voiceStateUpdate: async function(state: import("thunderstorm").VoiceState) {
		if (!state.guildID) return // we should only process voice state updates that are in guilds
		const queue = passthrough.queues.cache.get(state.guildID)

		// Process waiting to join
		// If someone else changed state, and their new state has a channel (i.e. just joined or switched channel)
		if (state.channelID) {
			if (queue && state.channelID === queue.voiceChannel.id) {
				// @ts-ignore
				const member: Discord.GuildMember = await utils.cacheManager.members.get(state.id, state.guildID, true, true)
				queue.listeners.set(state.id, member)
			} else if (queue) queue.listeners.delete(state.id)
			// @ts-ignore
			const vc: import("thunderstorm").VoiceChannel = await utils.cacheManager.channels.get(state.channelID, true, true)
			// Trigger all callbacks for that user in that guild
			common.voiceStateCallbackManager.getAll(state.id, state.guildID).forEach(s => s.trigger(vc))
		} else {
			if (queue) queue.listeners.delete(state.id)
		}

		if (queue) queue.voiceStateUpdate(state)
	}
}

utils.addTemporaryListener(client, "voiceStateUpdate", path.basename(__filename), common.voiceStateUpdate)

export = common
