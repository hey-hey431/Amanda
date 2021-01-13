// @ts-check

import ipc from "node-ipc"

import passthrough from "../../passthrough"
const { client, config, reloader } = passthrough

import utils from "../utilities"
reloader.sync("./modules/utilities/index.js", utils)

class IPC {
	public socket: any | null
	public replier: import("./ipcbotreplier") | null

	constructor() {
		ipc.config.networkHost = config.website_ipc_bind
		ipc.config.networkPort = 6544
		ipc.config.retry = 1500
		ipc.config.silent = true
		this.socket = null
		this.replier = null
	}

	setReplier(replier: import("./ipcbotreplier")) {
		this.replier = replier
	}

	connect() {
		const cluster = `cluster-${config.cluster_id}`
		ipc.config.id = cluster
		let shouldBeConnected = true // for ensuring that only one disconnect warning is sent
		ipc.connectToNet("website", () => {
			this.socket = ipc.of.website
			this.socket.once("connect", () => {
				shouldBeConnected = true
				this.socket.on("message", this.receive.bind(this))
			})
			this.socket.on("connect", () => {
				shouldBeConnected = true
				this.socket.emit("cluster", { clientID: client.user!.id, shards: config.shard_list, clusterID: config.cluster_id })
				console.log("Connected to web")
			})
			this.socket.on("disconnect", () => {
				if (shouldBeConnected === true) {
					console.log("Disconnected from web. This should not happen!")
				}
				shouldBeConnected = false
			})
		})
	}

	/**
	 * Called when the socket receives raw data.
	 */
	receive(raw: any) {
		if (this.replier) this.replier.baseOnMessage(raw, rawReply => this.send(rawReply))
	}

	/**
	 * Send raw data to the server.
	 */
	send(raw: any) {
		if (!this.socket) return
		this.socket.emit("message", raw)
	}
}

export = IPC
