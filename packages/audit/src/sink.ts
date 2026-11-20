import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { redactDeep } from "./redact.js";
import type { AuditEvent } from "./events.js";

/**
 * Storage seam. `AuditSink` is write-only (the common case); `AuditStore` adds reading for tools that
 * inspect a previous run. A future SQL/OTLP adapter implements the same two methods.
 */
export interface AuditSink {
  append(event: AuditEvent): Promise<void>;
}

export interface AuditStore extends AuditSink {
  read(): Promise<AuditEvent[]>;
}

/** In-memory sink for tests and SDK consumers that collect events themselves. */
export class MemoryAuditSink implements AuditStore {
  readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  async read(): Promise<AuditEvent[]> {
    return [...this.events];
  }
}

/**
 * JSONL file sink. One redacted JSON object per line, appended atomically per event.
 * Parent directories are created on demand; the file is never rewritten, so concurrent runs from
 * different jobs do not corrupt each other's history.
 */
export class JsonlAuditSink implements AuditStore {
  constructor(private readonly path: string) {}

  async append(event: AuditEvent): Promise<void> {
    const safe = redactDeep(event);
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(safe)}\n`, "utf8");
  }

  async read(): Promise<AuditEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch {
      return [];
    }
    const events: AuditEvent[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        events.push(JSON.parse(trimmed) as AuditEvent);
      } catch {
        // A corrupted line must not break the whole audit trail; it is skipped and the rest is kept.
      }
    }
    return events;
  }
}

/** Fan-out sink: one event, several destinations (file + CI log, for example). */
export class MultiAuditSink implements AuditSink {
  constructor(private readonly sinks: readonly AuditSink[]) {}

  async append(event: AuditEvent): Promise<void> {
    for (const sink of this.sinks) await sink.append(event);
  }
}

export function createAuditSink(options: { path?: string } = {}): AuditSink {
  return options.path ? new JsonlAuditSink(options.path) : new MemoryAuditSink();
}
