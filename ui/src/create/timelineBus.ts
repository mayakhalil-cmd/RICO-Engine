// Commands that act on what the timeline or the preview has on screen
// (twirled-open properties, selected keys, the active tool) go through here,
// so they can still be ordinary commands with keys you can change.

type Fn = (action: string) => boolean | void
const listeners = new Set<Fn>()

export function onTimelineAction(fn: Fn) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

// Returns true when something on screen took the action.
export function timelineAction(action: string): boolean {
  let taken = false
  listeners.forEach((l) => { if (l(action)) taken = true })
  return taken
}
