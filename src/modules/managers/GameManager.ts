const Discord: typeof import("thunderstorm") = require("thunderstorm")

import passthrough from "../../passthrough"

type AnyGame = import("../../commands/games").Game | import("../../commands/games").TriviaGame

class GameManager {
	public cache: import("thunderstorm").Collection<string, AnyGame>

	public constructor() {
		this.cache = new Discord.Collection()
	}
	public add(game: AnyGame) {
		passthrough.periodicHistory.add("game_start")
		this.cache.set(game.id, game)
	}
}

export = GameManager
