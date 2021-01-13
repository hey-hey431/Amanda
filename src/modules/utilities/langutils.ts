// @ts-check

import path from "path"
// @ts-ignore
import replace from "@amanda/lang/replace"

import passthrough from "../../passthrough"
const { reloadEvent } = passthrough

import { addTemporaryListener } from "./eventutils"
import sql from "./sql"


let Lang: typeof import("@amanda/lang") = require("@amanda/lang")

addTemporaryListener(reloadEvent, "@amanda/lang", path.basename(__filename), () => {
	Lang = require("@amanda/lang")
})

async function getLang(id: string, type: "self" | "guild"): Promise<import("@amanda/lang").Lang> {
	let code, row
	if (type === "self") {
		row = await sql.get("SELECT * FROM SettingsSelf WHERE keyID = ? AND setting = ?", [id, "language"])
	} else if (type === "guild") {
		row = await sql.get("SELECT * FROM SettingsGuild WHERE keyID = ? AND setting = ?", [id, "language"])
	}
	if (row) {
		code = row.value
	} else {
		code = "en-us"
	}

	// @ts-ignore
	const value = Lang[code.replace("-", "_")] || Lang.en_us
	return value
}

export = { getLang, replace }
