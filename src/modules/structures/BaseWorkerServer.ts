import express from "express"
const server = express()
server.disable("x-powered-by")

import config from "../../../config"

server.use(express.json({ type: ["application/json", "text/plain"], limit: "50mb" }))
server.use(express.urlencoded({ extended: true }))

type ServerCallback = (request: import("express").Request, response: import("express").Response) => any

class BaseWorkerServer {
	worker: "gateway" | "cache"
	server: typeof server
	password: string

	constructor(worker: "gateway" | "cache", password: string) {
		this.worker = worker
		this.server = server
		this.password = password

		this.initialize()
	}
	initialize() {
		let port: number
		if (this.worker === "cache") port = Number(config.cache_server_domain.split(":")[1])
		else {
			console.error("Invalid worker type")
			process.exit()
		}

		server.listen(port, () => console.log(`${this.worker} server started on port ${port}`))
	}
	authenticate(provided: string) {
		return provided === this.password
	}
	get(path: string, callback: ServerCallback) {
		server.get(path, (request, response) => this.defaultCallback(request, response, callback))
	}
	post(path: string, callback: ServerCallback) {
		server.post(path, (request, response) => this.defaultCallback(request, response, callback))
	}
	patch(path: string, callback: ServerCallback) {
		server.patch(path, (request, response) => this.defaultCallback(request, response, callback))
	}
	defaultCallback(request: import("express").Request, response: import("express").Response, callback: ServerCallback) {
		const auth = request.headers.authorization
		if (!auth) return response.status(404).send(this.createErrorResponse("Not found"))
		if (!this.authenticate(auth)) return response.status(404).send(this.createErrorResponse("Not found"))
		callback(request, response)
	}
	createErrorResponse(data: any) {
		return JSON.stringify({ error: data })
	}
	createDataResponse(data: any) {
		return JSON.stringify({ data: data })
	}
}

export = BaseWorkerServer
