const BaseReplier = require("../structures/BaseReplier")

class GatewayRequester extends BaseReplier {
	public worker: import("worker_threads").Worker

	public constructor(worker: import("worker_threads").Worker) {
		super()
		this.worker = worker
	}

	public getStats() {
		return this._makeRequest("STATS")
	}

	public statusUpdate(status: import("../../typings").GatewayStatusUpdateData): Promise<import("../../typings").PresenceData> {
		return this._makeRequest("STATUS_UPDATE", status)
	}

	public sendMessage(packet: import("lavacord").DiscordPacket) {
		return this._makeRequest("SEND_MESSAGE", packet)
	}

	public _makeRequest(op: "STATS" | "STATUS_UPDATE" | "SEND_MESSAGE", data?: any) {
		return this.baseRequest(op, data, (d: any) => this.worker.postMessage(d))
	}
}

export = GatewayRequester
