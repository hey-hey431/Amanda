import tap from "tap"
import passthrough from "./fakebot"
const { client } = passthrough

import utils from "./utilities"
const { replace } = utils

tap.test("replace", childTest => {
	childTest.equal(replace("hello world", { username: "Cadence" }), "hello world", "no action")

	childTest.equal(replace("%username", { username: "Cadence" }), "Cadence", "simple replace")

	childTest.equal(replace("Hello %username.", { username: "Cadence" }), "Hello Cadence.", "replace in middle")

	childTest.equal(replace("%username %username", { username: "Cadence" }), "Cadence Cadence", "multiple replace")
})
