import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

describe("password", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("hunter22-correct-horse");
    expect(hash).not.toBe("hunter22-correct-horse");
    expect(await verifyPassword("hunter22-correct-horse", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("produces different hashes for the same password", async () => {
    const a = await hashPassword("samesame");
    const b = await hashPassword("samesame");
    expect(a).not.toBe(b);
    expect(await verifyPassword("samesame", a)).toBe(true);
    expect(await verifyPassword("samesame", b)).toBe(true);
  });
});
