import { describe, expect, it } from "vitest";
import { describeError, redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it("removes passwords from connection URLs", () => {
    const text = "Can't reach database at postgresql://leadforge:s3cr3t!x@postgres:5432/leadforge and redis://:hunter2@redis:6379/0";
    const out = redactSecrets(text);
    expect(out).not.toContain("s3cr3t");
    expect(out).not.toContain("hunter2");
    expect(out).toContain("postgresql://leadforge:***@postgres:5432/leadforge");
  });

  it("removes bearer tokens and session cookies", () => {
    const out = redactSecrets("authorization: Bearer lfk_abc.DEF-123 cookie: lf_session=tok123; other=1");
    expect(out).not.toContain("lfk_abc");
    expect(out).not.toContain("tok123");
    expect(out).toContain("other=1");
  });

  it("leaves ordinary URLs and text alone", () => {
    const text = "fetched https://example.com/contact?a=1 in 20ms";
    expect(redactSecrets(text)).toBe(text);
  });

  it("redacts message and stack of thrown errors", () => {
    const described = describeError(new Error("connect postgres://u:pw@db/x failed"));
    expect(described.message).toBe("connect postgres://u:***@db/x failed");
    expect(described.stack).not.toContain(":pw@");
    expect(describeError("plain").name).toBe("NonError");
  });
});
