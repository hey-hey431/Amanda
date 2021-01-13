import BaseWorkerRequester from "../structures/BaseWorkerRequester"

import config from "../../../config"

class CacheRequester extends BaseWorkerRequester {
	public constructor() {
		super(`${config.cache_server_protocol}://${config.cache_server_domain}`, config.redis_password)
	}
	public getStats() {
		return this._makeRequest("/stats", "GET")
	}
	public getData(query: import("../../typings/index").CacheRequestData<keyof import("../../typings/index").CacheOperations>) {
		return this._makeRequest("/request", "POST", query)
	}
}

export = CacheRequester
