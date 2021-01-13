// @ts-check

import Amanda from "./structures/Discord/Amanda"
import { EventEmitter } from "events"
import SnowTransfer from "snowtransfer"

import passthrough from "../passthrough"

import config from "../../config"
import constants from "../constants"

const snow = new SnowTransfer(config.bot_token, { disableEveryone: true })
const client = new Amanda({ snowtransfer: snow })
const reloadEvent = new EventEmitter()

Object.assign(passthrough, { config, constants, client, reloadEvent })

export = passthrough
