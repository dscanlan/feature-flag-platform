import { EventEmitter } from "node:events";

/**
 * Tiny pub/sub the SSE handler subscribes to. Emits "change" with the new
 * version whenever a stage's ruleset is reloaded.
 */
export class StreamHub {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emitChange(stageId: string, version: number): void {
    this.emitter.emit(`change:${stageId}`, version);
  }

  onChange(stageId: string, listener: (version: number) => void): () => void {
    const evt = `change:${stageId}`;
    this.emitter.on(evt, listener);
    return () => this.emitter.off(evt, listener);
  }
}
