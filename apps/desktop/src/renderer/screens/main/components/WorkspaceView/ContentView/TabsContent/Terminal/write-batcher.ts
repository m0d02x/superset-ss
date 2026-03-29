import type { Terminal as XTerm } from "@xterm/xterm";

/**
 * Batches xterm.write() calls using requestAnimationFrame.
 *
 * Instead of writing per PTY data event (which can fire hundreds of times
 * per frame during high-throughput output), this accumulates data and
 * flushes once per animation frame — reducing layout/paint cycles.
 */
export class WriteBatcher {
	private buffer: string[] = [];
	private rafId: number | null = null;
	private xterm: XTerm | null = null;

	attach(xterm: XTerm): void {
		this.xterm = xterm;
	}

	detach(): void {
		this.flush();
		this.xterm = null;
	}

	write(data: string): void {
		this.buffer.push(data);
		if (this.rafId === null) {
			this.rafId = requestAnimationFrame(() => {
				this.rafId = null;
				this.flush();
			});
		}
	}

	flush(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		if (this.buffer.length === 0 || !this.xterm) return;
		const joined = this.buffer.join("");
		this.buffer.length = 0;
		this.xterm.write(joined);
	}

	dispose(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		this.buffer.length = 0;
		this.xterm = null;
	}
}
