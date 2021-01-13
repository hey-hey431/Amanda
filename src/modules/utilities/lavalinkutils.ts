import constants from "../../constants"

import passthrough from "../../passthrough"
const { client } = passthrough

/**
 * [removedCount, addedCount]
 */
export function applyChanges(): [number, number] {
	let removedCount = 0
	let addedCount = 0
	for (const node of client.lavalink.nodes.values()) {
		if (!constants.lavalinkNodes.find(n => n.host === node.host)) {
			removedCount++
			const nodeInstance = client.lavalink.nodes.get(node.host)
			client.lavalink.removeNode(node.host)
			if (nodeInstance) nodeInstance.destroy()
		}
	}

	for (const node of constants.lavalinkNodes) {
		if (!client.lavalink.nodes.has(node.host)) {
			addedCount++
			client.lavalink.createNode(node)
		}
	}
	return [removedCount, addedCount]
}

export function removeByName(name: string) {
	constants.lavalinkNodes = constants.lavalinkNodes.filter(node => node.name !== name)
	return applyChanges()
}

export function add(data: any) {
	constants.lavalinkNodes.push(data)
	return applyChanges()
}

/**
 * Add enabled and disconnected nodes to the client node list and connect to them.
 * Clean unused and disabled client nodes and close their websockets
 * so that the lavalink process can be ended safely.
 *
 * [cleaned nodes, added nodes]
 */
export async function syncConnections() {
	let cleanedCount = 0
	let addedCount = 0

	for (const node of constants.lavalinkNodes) { // loop through all known nodes
		const clientNode = [...client.lavalink.nodes.values()].find(n => n.host === node.host) // get the matching client node
		if (node.enabled) { // try connecting to nodes
			if (clientNode) continue // only consider situations where the client node is unknown
			// connect to the node
			const newNode = client.lavalink.createNode(node)
			await newNode.connect()
			console.log(`${newNode.id} LavaLink node connected`)
			addedCount++
		} else { // try disconnecting from nodes
			if (!clientNode) continue // only consider situations where the client node is known
			// if no queues are using the node, disconnect it.
			await fallover(node.id)
			client.lavalink.removeNode(clientNode.id)
			console.log(`${clientNode.id} LavaLink node destroyed`)
			cleanedCount++
		}
	}

	return [cleanedCount, addedCount]
}

/**
 * @param nodeID The nodeID that will be switched off of
 */
export async function fallover(nodeID: string) {
	const queues = passthrough.queues // file load order means queueStore cannot be extracted at top of file

	for (const q of queues.cache.values()) {
		if (q.nodeID === nodeID) {
			const p = await q.player
			const newLocalNode = constants.lavalinkNodes.find(i => i.enabled === true) || constants.lavalinkNodes[0]
			if (!newLocalNode) {
				const audit = queues.audits.get(q.guild.id)
				if (audit) audit.push({ action: "Queue Destroy (Error while load balancing)", platform: "Discord", user: "Amanda" })
				q._dissolve()
			}
			const newNode = client.lavalink.nodes.get(newLocalNode.id)!
			await client.lavalink.switch(p, newNode)
			q.nodeID = newLocalNode.id
		}
	}
}

export default { applyChanges, removeByName, add, syncConnections, fallover }
