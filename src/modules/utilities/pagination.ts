// @ts-check

import Discord from "thunderstorm"
import ReactionMenu from "@amanda/reactionmenu"
import { contentify, createMessageCollector } from "./discordutils"
import { shuffle as arrayShuffle } from "./arrayutils"
import passthrough from "../../passthrough"
const { constants, client } = passthrough
import { cacheManager } from "./cachemanager"


export function createPages(rows: Array<string>, maxLength: number, itemsPerPage: number, itemsPerPageTolerance: number) {
	const pages = []
	let currentPage = []
	let currentPageLength = 0
	const currentPageMaxLength = maxLength
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]
		if ((currentPage.length >= itemsPerPage && rows.length - i > itemsPerPageTolerance) || currentPageLength + row.length + 1 > currentPageMaxLength) {
			pages.push(currentPage)
			currentPage = []
			currentPageLength = 0
		}
		currentPage.push(row)
		currentPageLength += row.length + 1
	}
	pages.push(currentPage)
	return pages
}

export function tableifyRows(rows: Array<Array<string>>, align: Array<"left" | "right">, surround: (currentLine?: number) => string = () => "", spacer = " "): Array<string> { // SC: en space
	/** @type {string[]} */
	const output: string[] = []
	const maxLength = []
	for (let i = 0; i < rows[0].length; i++) {
		let thisLength = 0
		for (let j = 0; j < rows.length; j++) {
			if (thisLength < rows[j][i].length) thisLength = rows[j][i].length
		}
		maxLength.push(thisLength)
	}
	for (let i = 0; i < rows.length; i++) {
		let line = ""
		for (let j = 0; j < rows[0].length; j++) {
			if (align[j] == "left" || align[j] == "right") {
				line += surround(i)
				if (align[j] == "left") {
					const pad = " ​"
					const padding = pad.repeat(maxLength[j] - rows[i][j].length)
					line += rows[i][j] + padding
				} else if (align[j] == "right") {
					const pad = "​ "
					const padding = pad.repeat(maxLength[j] - rows[i][j].length)
					line += padding + rows[i][j]
				}
				line += surround(i)
			} else {
				line += rows[i][j]
			}
			if (j < rows[0].length - 1) line += spacer
		}
		output.push(line)
	}
	return output
}

/**
 * @param {Discord.PartialChannel} channel
 * @param {string[]} title
 * @param {string[][]} rows
 */
export function createPagination(channel: Discord.PartialChannel, title: Array<string>, rows: Array<Array<string>>, align: Array<"left" | "right">, maxLength: number) {
	let alignedRows = tableifyRows([title].concat(rows), align, () => "`")
	const formattedTitle = alignedRows[0].replace(/`.+?`/g, sub => `__**\`${sub}\`**__`)
	alignedRows = alignedRows.slice(1)
	const pages = createPages(alignedRows, maxLength - formattedTitle.length - 1, 16, 4)
	paginate(channel, pages.length, page => {
		return contentify(channel,
			new Discord.MessageEmbed()
				.setTitle("Viewing all playlists")
				.setColor(constants.standard_embed_color)
				.setDescription(`${formattedTitle}\n${pages[page].join("\n")}`)
				.setFooter(`Page ${page + 1} of ${pages.length}`)
		)
	})
}


export async function paginate(channel: Discord.PartialChannel, pageCount: number, callback: (page: number) => any) {
	let page = 0
	const msg = await channel.send(await callback(page))
	if (pageCount > 1) {
		let reactionMenuExpires: NodeJS.Timeout
		// @ts-ignore
		const reactionMenu = new ReactionMenu(msg, client, [
			{ emoji: "bn_ba:328062456905728002", remove: "user", actionType: "js", actionData: async () => {
				page--
				if (page < 0) page = pageCount - 1
				msg.edit(await callback(page))
				makeTimeout()
			} },
			{ emoji: "bn_fo:328724374465282049", remove: "user", actionType: "js", actionData: async () => {
				page++
				if (page >= pageCount) page = 0
				msg.edit(await callback(page))
				makeTimeout()
			} }
		])
		const channelType = await cacheManager.channels.typeOf(channel)
		// eslint-disable-next-line no-inner-declarations
		function makeTimeout() {
			clearTimeout(reactionMenuExpires)
			reactionMenuExpires = setTimeout(() => {
				reactionMenu.destroy(true, channelType === "dm" ? "dm" : "text")
			}, 10 * 60 * 1000)
		}
		makeTimeout()
	}
}

export function removeEnd(rows: Array<string>, maxLength = 2000, joinLength = 1, endString = "…") {
	let currentLength = 0
	const maxItems = 20
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]
		if (i >= maxItems || currentLength + row.length + joinLength + endString.length > maxLength) {
			return rows.slice(0, i).concat([endString])
		}
		currentLength += row.length + joinLength
	}
	return rows
}

export function removeMiddle(rows: Array<string>, maxLength = 2000, joinLength = 1, middleString = "…") {
	let currentLength = 0
	let currentItems = 0
	const maxItems = 20
	/**
	 * Holds items for the left and right sides.
	 * Items should flow into the left faster than the right.
	 * At the end, the sides will be combined into the final list.
	 */
	const reconstruction: Map<"left" | "right", Array<string>> = new Map([
		["left", []],
		["right", []]
	])
	let leftOffset = 0
	let rightOffset = 0
	function getNextDirection() {
		return rightOffset * 3 > leftOffset ? "left" : "right"
	}
	while (currentItems < rows.length) {
		const direction = getNextDirection()
		let row
		if (direction == "left") row = rows[leftOffset++]
		else row = rows[rows.length - 1 - rightOffset++]
		let r = ["null"] // This should theoretically never fall through
		if (currentItems >= maxItems || currentLength + row.length + joinLength + middleString.length > maxLength) {
			const left = reconstruction.get("left")
			const right = reconstruction.get("right")
			if (left && right) r = left.concat([middleString], right.reverse())
			return r
		}
		const v = reconstruction.get(direction)
		if (v) v.push(row)
		currentLength += row.length + joinLength
		currentItems++
	}
	const left = reconstruction.get("left")
	const right = reconstruction.get("right")
	let r = ["null"]
	if (left && right) r = left.concat(right.reverse())
	return r
}

export function playlistSection<T>(items: Array<T>, startString: string, endString: string, shuffle: boolean): Array<T> {
	let from = startString == "-" ? 1 : (Number(startString) || 1)
	let to = endString == "-" ? items.length : (Number(endString) || from || items.length) // idk how to fix this
	from = Math.max(from, 1)
	to = Math.min(items.length, to)
	if (startString) items = items.slice(from - 1, to)
	if (shuffle) {
		arrayShuffle(items)
	}
	if (!startString && !shuffle) items = items.slice() // make copy of array for consistent behaviour
	return items
}

export function makeSelection(channel: Discord.PartialChannel, authorID: string, title: string, failedTitle: string, items: Array<string>, embed?: Discord.MessageEmbed): Promise<number | null> {
	// eslint-disable-next-line no-async-promise-executor
	return new Promise(async (res) => {
		// Set up embed
		if (!embed) embed = new Discord.MessageEmbed()
		embed.setTitle(title)
		embed.setDescription(items.join("\n"))
		embed.setColor(constants.standard_embed_color)
		embed.setFooter(`Type a number from 1-${items.length} to select that item`)
		// Send embed
		const selectmessage = await channel.send(await contentify(channel, embed))
		// Make collector
		async function cb(newmessage?: Discord.Message) {
			if (!newmessage) return res(null)
			// Collector got a message
			let index = Number(newmessage.content)
			// Is index a number?
			if (isNaN(index)) return onFail()
			index--
			// Is index in bounds?
			if (index < 0 || index >= items.length) return onFail()
			// Edit to success
			embed!.setDescription(`» ${items[index]}`)
			embed!.setFooter("")
			selectmessage.edit(await contentify(selectmessage.channel, embed!))
			return res(index)
		}
		async function onFail() {
			// Collector failed, show the failure message and return null
			embed!.setTitle(failedTitle)
			embed!.setDescription("")
			embed!.setFooter("")
			selectmessage.edit(await contentify(selectmessage.channel, embed!))
			return res(null)
		}
		createMessageCollector({ channelID: channel.id, userIDs: [authorID] }, cb, onFail)
	})
}

export const compactRows = {
	removeEnd,
	removeMiddle
}

export default { createPages, tableifyRows, createPagination, paginate, removeEnd, removeMiddle, playlistSection, makeSelection, compactRows }
