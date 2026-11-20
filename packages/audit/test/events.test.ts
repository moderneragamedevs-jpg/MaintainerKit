import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAuditEvent, formatAuditEvent, type AuditEvent } from "../src/events.js";
import { JsonlAuditSink, MemoryAuditSink, MultiAuditSink } from "../src/sink.js";

const NOW = new Date("2026-02-03T04:05:06.000Z");

describe("audit events", () => {
  it("creates an event with stable identity and injected timestamp", () => {
    const event = createAuditEvent({
      type: "policy.evaluated",
      status: "success",
      now: NOW,
      id: "evt_fixed",
      repository: { provider: "github", owner: "acme", name: "widget" },
      policyVersion: "1.0",
      output: { status: "pass", findings: 4, failed: 0 },
    });

    expect(event).toMatchObject({
      id: "evt_fixed",
      timestamp: "2026-02-03T04:05:06.000Z",
      type: "policy.evaluated",
      status: "success",
      policyVersion: "1.0",
      actor: { kind: "cli" },
    });
  });

  it("omits absent optional fields instead of writing nulls", () => {
    const event = createAuditEvent({ type: "run.started", status: "unknown", now: NOW });
    expect(Object.keys(event).sort()).toEqual(["actor", "id", "status", "timestamp", "type"]);
  });

  it("records approval decisions", () => {
    const event = createAuditEvent({
      type: "write.blocked",
      status: "blocked",
      now: NOW,
      approval: { required: true, granted: false },
    });
    expect(event.approval).toEqual({ required: true, granted: false });
  });

  it("formats a compact log line without secrets", () => {
    const event = createAuditEvent({
      type: "policy.evaluated",
      status: "failure",
      now: NOW,
      repository: { provider: "github", owner: "acme", name: "widget" },
      policyVersion: "1.0",
      output: { status: "fail", findings: 5, failed: 2 },
      provider: { id: "mock", model: "mock-1" },
    });
    const line = formatAuditEvent(event);
    expect(line).toContain("policy.evaluated");
    expect(line).toContain("acme/widget");
    expect(line).toContain("policy=1.0");
    expect(line).toContain("findings=5/2 failed");
    expect(line).toContain("provider=mock");
  });
});

describe("audit sinks", () => {
  it("collects events in memory", async () => {
    const sink = new MemoryAuditSink();
    await sink.append(createAuditEvent({ type: "run.started", status: "unknown", now: NOW }));
    expect(await sink.read()).toHaveLength(1);
  });

  it("writes JSONL, creates directories, and redacts on write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "maintainerkit-audit-"));
    const path = join(dir, "nested", "audit.jsonl");
    const token = `ghp_${"a".repeat(36)}`;
    try {
      const sink = new JsonlAuditSink(path);
      await sink.append(
        createAuditEvent({
          type: "ai.failed",
          status: "failure",
          now: NOW,
          metadata: { detail: `request failed with ${token}` },
        }),
      );

      const events = await sink.read();
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events[0])).not.toContain(token);
      expect(events[0]?.metadata?.detail).toContain("***REDACTED***");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips corrupt lines instead of losing the whole trail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "maintainerkit-audit-"));
    const path = join(dir, "audit.jsonl");
    try {
      const sink = new JsonlAuditSink(path);
      await sink.append(createAuditEvent({ type: "run.started", status: "unknown", now: NOW }));
      const { appendFile } = await import("node:fs/promises");
      await appendFile(path, "not json\n", "utf8");
      await sink.append(createAuditEvent({ type: "run.completed", status: "success", now: NOW }));

      const events: AuditEvent[] = await sink.read();
      expect(events).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty list for a missing log", async () => {
    const sink = new JsonlAuditSink(join(tmpdir(), "definitely-missing-maintainerkit.jsonl"));
    expect(await sink.read()).toEqual([]);
  });

  it("fans out to every sink", async () => {
    const a = new MemoryAuditSink();
    const b = new MemoryAuditSink();
    const multi = new MultiAuditSink([a, b]);
    await multi.append(createAuditEvent({ type: "run.started", status: "unknown", now: NOW }));
    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(1);
  });
});
