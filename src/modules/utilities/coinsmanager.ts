import sql from "./sql"

const startingCoins = 5000


export function create(userID: string, extra = 0) {
	return sql.all("REPLACE INTO money(userID, coins) VALUES (?, ?)", [userID, startingCoins + extra]).then(() => startingCoins + extra)
}

export async function get(userID: string): Promise<number> {
	const row = await sql.get("SELECT * FROM money WHERE userID = ?", userID)
	if (row) return row.coins
	else return create(userID)
}

export async function getRow(userID: string, fields = "*"): Promise<{ userID: string; coins: number; woncoins: number; lostcoins: number; givencoins: number }> {
	const statement = `SELECT ${fields} FROM money WHERE userID =?`
	const row = await sql.get(statement, userID)
	// @ts-ignore
	if (row) return row
	else {
		await create(userID)
		// @ts-ignore
		return sql.get(statement, userID)
	}
}

export async function set(userID: string, value: number) {
	const row = await sql.get("SELECT * FROM money WHERE userID = ?", userID)
	if (row) sql.all("UPDATE money SET coins = ? WHERE userID = ?", [value, userID])
	else await sql.all("INSERT INTO money (userID, coins) VALUES (?, ?)", [userID, value])
}

export async function award(userID: string, value: number) {
	const row = await sql.get("SELECT * FROM money WHERE userID = ?", userID)
	if (row) {
		const earned = value > 0
		const coinfield = earned ? "woncoins" : "lostcoins"
		await sql.all(`UPDATE money SET coins = ?, ${coinfield} = ${coinfield} + ? WHERE userID = ?`, [row.coins + value, earned ? value : (value * -1), userID])
	} else {
		await create(userID, value)
	}
}

export async function transact(user1: string, user2: string, amount: number) {
	const u1row = await getRow(user1)
	const u2coins = await get(user2)

	await Promise.all([
		sql.all("UPDATE money SET coins =? WHERE userID =?", [u2coins + amount, user2]),
		sql.all("UPDATE money SET coins =?, givencoins =? WHERE userID =?", [u1row.coins - amount, u1row.givencoins + amount, user1])
	])
}

export async function updateCooldown(userID: string, command: string, info: { max: number; min: number; step: number; regen: { time: number; amount: number } }) {
	let winChance = info.max
	const cooldown = await sql.get("SELECT * FROM MoneyCooldown WHERE userID = ? AND command = ?", [userID, command])
	if (cooldown) {
		winChance = Math.max(info.min, Math.min(info.max, cooldown.value + Math.floor((Date.now() - cooldown.date) / info.regen.time) * info.regen.amount))
		const newValue = winChance - info.step
		sql.all("UPDATE MoneyCooldown SET date = ?, value = ? WHERE userID = ? AND command = ?", [Date.now(), newValue, userID, command])
	} else sql.all("INSERT INTO MoneyCooldown VALUES (NULL, ?, ?, ?, ?)", [userID, command, Date.now(), info.max - info.step])
	return winChance
}

export default { create, get, getRow, set, award, transact, updateCooldown }
