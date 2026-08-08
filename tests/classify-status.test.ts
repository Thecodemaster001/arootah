import { describe, expect, it } from "vitest";
import { RetryableError, classifyStatus } from "@/lib/providers/types";

describe("classifyStatus", () => {
  it.each([429, 500, 503, 529])("retries status %i", (status) => {
    const error = classifyStatus(status, "boom");
    expect(error).toBeInstanceOf(RetryableError);
    expect((error as RetryableError).status).toBe(status);
  });

  it.each([400, 401, 403, 404, undefined])("does not retry status %s", (status) => {
    expect(classifyStatus(status, "boom")).not.toBeInstanceOf(RetryableError);
  });

  it.each(["insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached"])(
    "treats a 429 carrying %s as permanent",
    (code) => {
      const error = classifyStatus(429, "out of credit", undefined, null, code);
      expect(error).not.toBeInstanceOf(RetryableError);
      expect(error.message).toBe("out of credit");
    },
  );
});
