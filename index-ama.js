process.title = "Amanda";
const fs = require("fs");
const Auth =(process.env.is_heroku)? JSON.parse(process.env.auth):JSON.parse(fs.readFileSync("./auth.json", "utf8"));
const events = require("events");
let reloadEvent = new events.EventEmitter();
let utils = {};
const commands = {};

const Discord = require('discord.js');
const discordClient = require("dualcord");
const client = new discordClient();
client.login({ token: Auth.bot_token });
const dio = client.dioClient();
const djs = client.djsClient();

console.log(`Starting`);

if (process.env.is_heroku) require("http").createServer(new Function(), process.env.PORT);

let db = require("./database.js")();
let passthrough = { Discord, client, djs, dio, reloadEvent, utils, db, commands };
require("./plugins.js")(passthrough);