// @ts-check

import Discord from "thunderstorm"
import path from "path"
import repl from "repl"
import util from "util"
import vm from "vm"

import passthrough from "../passthrough"
const { config, client, commands, db, reloader, reloadEvent, internalEvents, games, queues, frisky, nedb, periodicHistory } = passthrough

import utils from "../modules/utilities"
reloader.sync("./modules/utilities/index.js", utils)

async function customEval(input: string, context: vm.Context, filename: string, callback: (err: Error | null, result: any) => any) {
	let depth = 0
	if (input == "exit\n") return process.exit()
	if (input.startsWith(":")) {
		const depthOverwrite = input.split(" ")[0]
		depth = +depthOverwrite.slice(1)
		input = input.slice(depthOverwrite.length + 1)
	}
	const result = await eval(input)
	const output = util.inspect(result, false, depth, true)
	return callback(null, output)
}

reloadEvent.once(path.basename(__filename), () => {
	console.log("stdin.js does not auto-reload.")
})

internalEvents.once("prefixes", () => {
	const cli = repl.start({ prompt: "> ", eval: customEval, writer: s => s })

	Object.assign(cli.context, passthrough, { Discord })

	cli.once("exit", () => {
		process.exit()
	})
})
