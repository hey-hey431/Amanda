import util from "util"

import passthrough from "../../passthrough"
const { db } = passthrough


export function all(string: string, prepared: string | number | symbol | Array<(string | number | symbol | undefined)> | undefined = undefined, connection: import("mysql2/promise").Pool | import("mysql2/promise").PoolConnection | undefined = undefined, attempts = 2): Promise<Array<import("mysql2/promise").RowDataPacket>> {
	if (prepared !== undefined && typeof (prepared) != "object") prepared = [prepared]
	return new Promise((resolve, reject) => {
		if (Array.isArray(prepared) && prepared.includes(undefined)) {
			return reject(new Error(`Prepared statement includes undefined\n	Query: ${string}\n	Prepared: ${util.inspect(prepared)}`))
		}
		if (!connection) connection = db
		connection.execute(string, prepared).then(result => {
			const rows = result[0]
			// @ts-ignore
			resolve(rows)
		}).catch(err => {
			console.error(err)
			attempts--
			console.log(string, prepared)
			if (attempts) all(string, prepared, connection, attempts).then(resolve).catch(reject)
			else reject(err)
		})
	})
}

export function get(string: string, prepared: string | number | symbol | Array<(string | number | symbol | undefined)> | undefined = undefined, connection: import("mysql2/promise").Pool | import("mysql2/promise").PoolConnection | undefined = undefined): Promise<import("mysql2/promise").RowDataPacket> {
	return all(string, prepared, connection).then(rows => rows[0])
}

export function getConnection() {
	return db.getConnection()
}

export async function hasPermission(user: import("thunderstorm").User, permission: "eval" | "owner"): Promise<boolean> {
	let result = await get(`SELECT ${permission} FROM UserPermissions WHERE userID = ?`, user.id)
	if (result) result = Object.values(result)[0]
	return !!result
}

export default { all, get, getConnection, hasPermission }
