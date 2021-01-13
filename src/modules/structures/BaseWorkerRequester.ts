import fetch from "node-fetch"
import util from "util"

class BaseWorkerRequester {
	public baseURL: string
	public auth: string | null

	constructor(baseURL: string, auth?: string) {
		this.baseURL = baseURL
		this.auth = auth || null
	}
	async _makeRequest(path: string, method: "GET" | "PATCH" | "POST" = "GET", body?: any): Promise<any> {
		if (!path.startsWith("/")) path = `/${path}`
		const payload: { body?: string, headers?: { [key: string]: any }, method?: string } = {}
		const headers: { [key: string]: any } = {}
		if (body) payload["body"] = JSON.stringify(body)
		if (this.auth) headers["Authorization"] = this.auth

		payload["method"] = method
		payload["headers"] = headers

		// @ts-ignore
		const response = await fetch(encodeURI(`${this.baseURL}${path}`), payload)
		if (!response) return Promise.reject(new Error(`An error occured when requesting from a worker\n${util.inspect({ url: `${this.baseURL}${path}`, method: method, payload: payload })}`))

		if (response.status != 200) {
			const d = await response.json()
			return Promise.reject(new Error(`An error occured when requesting from a worker\n${util.inspect({ status: response.status, error: d.error })}`))
		}

		const data = await response.json()

		return data.data
	}
}

export = BaseWorkerRequester
