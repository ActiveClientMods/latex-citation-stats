// Keyed debouncer.
//
// Text-change events fire on a per-document basis, so we debounce per file key
// rather than globally. Typing rapidly in `main.tex` must not delay or cancel a
// pending re-parse of `chapter1.tex`. Each key gets its own trailing timer.

export class KeyedDebouncer {
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(private readonly delayMs: number) {}

	/** (Re)schedule `fn` for `key`, resetting any in-flight timer for that key. */
	schedule(key: string, fn: () => void): void {
		const existing = this.timers.get(key);
		if (existing) {
			clearTimeout(existing);
		}
		this.timers.set(
			key,
			setTimeout(() => {
				this.timers.delete(key);
				fn();
			}, this.delayMs),
		);
	}

	/** Cancel a pending run for a key, if any (e.g. when the file is deleted). */
	cancel(key: string): void {
		const existing = this.timers.get(key);
		if (existing) {
			clearTimeout(existing);
			this.timers.delete(key);
		}
	}

	/** Cancel every pending run. Called on extension deactivation. */
	dispose(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
	}
}
