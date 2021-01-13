// @ts-check

import BaseReplier from "../structures/BaseReplier"

/**
 * Keywords:
 * - RECEIVE: an unthreaded message has come in, act on it and don't reply (because we can't reply)
 * - REPLY: a message has come in, act on it and send a reply to that thread
 * - REQUEST: send a message requesting a reply, wait for the reply, then return or operate on it
 * - SEND: send a message without requesting a reply
 */
class Replier extends BaseReplier {
	constructor() {
		super()
	}
	async baseOnMessage(raw: { op: string, data: any, threadID: string }, replyFn: (data: { threadID: string, data: any }) => any) {
		const { op, data, threadID } = raw
		// 5. receive request for stats
		if (op) {
			if (threadID) {
				// receives something like {op: "GET_GUILDS_FOR_USER", threadID: 1, data: {userID: "..."}}
				// this is for us to act on and respond to because it has an op and a thread
				// 6. get reply data
				let replyData
				// @ts-ignore
				if (this[`REPLY_${op}`]) {
					// @ts-ignore
					replyData = await this[`REPLY_${op}`](data)
				} else { // we can only have one thing replying.
					for (const receiver of this.receivers.values()) {
						if (receiver.op === op) {
							replyData = await receiver.fn(data)
							break // exit the receiver loop -\
						}
					} // \- to here
				}
				if (replyData === undefined) throw new Error(`Nothing replied to op ${op}`)
				// sends something like {threadID: 1, data: {guilds: []}}
				// 7. send reply
				replyFn({ threadID: threadID, data: replyData })
			} else {
				// receives something like {op: "ADD_QUEUE", data: {...}}
				// this is for us to act on but not respond to because it has an op but no thread
				// @ts-ignore
				if (this[`RECEIVE_${op}`]) this[`RECEIVE_${op}`](data)
				for (const receiver of this.receivers.values()) {
					if (receiver.op === op) receiver.fn(data)
				}
			}
		} else {
			// receives something like {threadID: 1, data: {stats: []}}
			// this has a thread and no op, and is therefore a reply to something we sent earlier
			// 8. response to get stats arrives. call the promise resolve from the outgoing map and delete the key
			const existing = this.outgoing.get(threadID)
			if (existing) {
				if (this.outgoingPersist.has(threadID)) existing(data)
				else {
					const v = this.outgoing.use(threadID)
					if (v) v(data)
				}
			} else console.error("threadID has no outgoing! This should not happen. Incoming message:", raw)
		}
	}
}

export = Replier
