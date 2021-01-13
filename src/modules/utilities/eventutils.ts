import events from "events"
import passthrough from "../../passthrough"

export function addTemporaryListener(target: events.EventEmitter, name: string, filename: string, code: (...args: Array<any>) => any, targetListenMethod: "on" | "once" = "on") {
	console.log(`added event ${name}`)
	target[targetListenMethod](name, code)
	passthrough.reloadEvent.once(filename, () => {
		target.removeListener(name, code)
		console.log(`removed event ${name}`)
	})
}

export default { addTemporaryListener }
