import SingleUseMap from "../structures/SingleUseMap"

class BaseReplier {
	public outgoing: SingleUseMap<string, (value?: unknown) => any>
	public outgoingPersist: Set<string>
	public receivers: Map<string, import("../../typings/index").IPCReceiver>
	public lastThreadID: number

	constructor() {
		this.outgoing = new SingleUseMap()
		this.outgoingPersist = new Set()
		this.receivers = new Map()
		this.lastThreadID = 0
	}

	nextThreadID() {
		return `${process.pid}_${(++this.lastThreadID)}`
	}

	addReceivers(receivers: [string, import("../../typings/index").IPCReceiver][]) {
		receivers.forEach(entry => {
			this.receivers.set(entry[0], entry[1])
		})
	}

	buildRequest(op: string, data: any) {
		const threadID = this.nextThreadID()
		return { threadID, op, data }
	}

	baseRequest(op: string, data: any, sendFn: (raw: { threadID: string, op: string, data: any }) => any): Promise<any> {
		// 3. request to a client
		const raw = this.buildRequest(op, data)
		// actually send
		sendFn(raw)
		return new Promise(resolve => {
			// 4. create a promise whose resolve will be called later when threadID is checked in onMessage.
			this.outgoing.set(raw.threadID, resolve)
		})
	}
}

export = BaseReplier
