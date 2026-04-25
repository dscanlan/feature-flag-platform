import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./helpers/testApp.js";
import { writeAudit } from "../src/db/audit.js";

/**
 * Unit test for the writeAudit helper — distinguishes "absent" fields (SQL
 * NULL) from "present but the JSON value is null" (JSONB 'null').
 */
describe("writeAudit", () => {
  let h: TestHarness;
  beforeAll(async () => {
    h = await createTestHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("stores SQL NULL when before/after are omitted", async () => {
    const client = await h.pool.connect();
    try {
      await writeAudit(client, {
        workspaceId: null,
        actorUserId: null,
        action: "test.absent",
        target: "t",
      });
    } finally {
      client.release();
    }
    const row = await h.pool.query<{ before: unknown; after: unknown }>(
      "SELECT before, after FROM audit_log WHERE action = 'test.absent'",
    );
    expect(row.rows[0]!.before).toBeNull();
    expect(row.rows[0]!.after).toBeNull();
  });

  it("stores JSON 'null' when before/after are explicit null", async () => {
    const client = await h.pool.connect();
    try {
      await writeAudit(client, {
        workspaceId: null,
        actorUserId: null,
        action: "test.explicit-null",
        target: "t",
        before: null,
        after: { ok: true },
      });
    } finally {
      client.release();
    }
    // pg returns JSONB 'null' as JS null, same as SQL NULL — cast to text to
    // distinguish.
    const raw = await h.pool.query<{ before: string | null; after: string | null }>(
      "SELECT before::text, after::text FROM audit_log WHERE action = 'test.explicit-null'",
    );
    expect(raw.rows[0]!.before).toBe("null");
    expect(raw.rows[0]!.after).toBe('{"ok": true}');
  });
});
