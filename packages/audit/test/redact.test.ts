import { describe, expect, it } from "vitest";
import {
  containsLikelySecret,
  REDACTED,
  redact,
  redactDeep,
  redactSecrets,
} from "../src/redact.js";

describe("secret redaction", () => {
  it("redacts GitHub tokens", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const result = redactSecrets(`token=${token}`);
    expect(result.value).not.toContain(token);
    expect(result.value).toContain(REDACTED);
    expect(result.redacted).toContain("github-token");
  });

  it("redacts fine-grained GitHub tokens", () => {
    expect(redact(`x github_pat_${"A".repeat(30)} y`)).not.toContain("github_pat_");
  });

  it("redacts OpenAI and Anthropic keys", () => {
    expect(redact(`key sk-proj-${"a".repeat(32)}`)).not.toContain("sk-proj-");
    expect(redact(`key sk-ant-${"a".repeat(32)}`)).not.toContain("sk-ant-");
  });

  it("redacts AWS access keys and npm tokens", () => {
    expect(redact("AKIAIOSFODNN7EXAMPLE")).toBe(REDACTED);
    expect(redact(`npm_${"b".repeat(36)}`)).toBe(REDACTED);
  });

  it("redacts bearer headers but keeps the scheme", () => {
    const result = redactSecrets("Authorization: Bearer abcdef1234567890");
    expect(result.value).toContain("Bearer");
    expect(result.value).toContain(REDACTED);
    expect(result.value).not.toContain("abcdef1234567890");
  });

  it("redacts private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----";
    expect(redact(pem)).toBe(REDACTED);
  });

  it("redacts credential assignments in YAML and env style", () => {
    expect(redact("password: hunter2hunter2")).not.toContain("hunter2");
    expect(redact('api_key = "abcdef123456"')).not.toContain("abcdef123456");
  });

  it("leaves ordinary text alone", () => {
    const text = "The build failed because the test expected 1 but received 2.";
    expect(redact(text)).toBe(text);
    expect(containsLikelySecret(text)).toBe(false);
  });

  it("redacts every occurrence, not just the first", () => {
    const result = redactSecrets(`${`ghp_${"c".repeat(36)}`} and ${`ghp_${"d".repeat(36)}`}`);
    expect(result.count).toBe(2);
  });

  it("is idempotent", () => {
    const once = redact(`token ghp_${"e".repeat(36)}`);
    expect(redact(once)).toBe(once);
  });

  it("does not catastrophically backtrack on hostile input", () => {
    const hostile = `password: ${"a".repeat(20000)}` + "!".repeat(2000);
    const started = Date.now();
    redact(hostile);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("redacts deeply nested structures and keys", () => {
    const token = `ghp_${"f".repeat(36)}`;
    const input = { a: [{ b: `x ${token}` }], [token]: "value" };
    const output = redactDeep(input);
    const serialised = JSON.stringify(output);
    expect(serialised).not.toContain(token);
    expect(serialised).toContain(REDACTED);
  });
});
