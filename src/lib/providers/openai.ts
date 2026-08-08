import OpenAI from "openai";
import { TRIAGE_JSON_SCHEMA } from "../schema";
import { classifyStatus, RetryableError, type Prompt, type Provider } from "./types";

const DEFAULT_MODEL = "gpt-5";

/**
 * Structured Outputs in strict mode: the schema is enforced server-side, so a
 * successful response is valid JSON matching the shape by construction. The
 * one thing it does not guarantee is completion — a length-capped response
 * yields well-formed-but-truncated output, which is why `finish_reason` is
 * checked before the body is parsed.
 *
 * `temperature` is deliberately unset: reasoning models reject any non-default
 * value, and determinism here comes from a tight schema, not from sampling.
 */
type ClientOverrides = Pick<NonNullable<ConstructorParameters<typeof OpenAI>[0]>, "fetch">;

/** `overrides.fetch` lets tests drive the real SDK against a fake transport. */
export function openaiProvider(overrides: ClientOverrides = {}): Provider {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set (see .env.example)");

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  // Retry policy lives in triage.ts. The SDK's own retries (2 by default) would
  // multiply it and re-send quota 429s that classifyStatus marks permanent.
  const client = new OpenAI({ apiKey, maxRetries: 0, ...overrides });

  return {
    name: "openai",
    model,
    async complete(prompt: Prompt, signal?: AbortSignal): Promise<unknown> {
      try {
        const response = await client.chat.completions.create(
          {
            model,
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            response_format: {
              type: "json_schema",
              json_schema: { name: "triage_result", strict: true, schema: TRIAGE_JSON_SCHEMA },
            },
          },
          { signal },
        );

        const choice = response.choices[0];
        if (choice?.finish_reason === "length") {
          throw new Error("Response truncated before the model finished the object");
        }
        if (choice?.message.refusal) {
          throw new Error(`Model refused: ${choice.message.refusal}`);
        }
        const content = choice?.message.content;
        if (!content) throw new Error("Empty response body");

        return JSON.parse(content);
      } catch (error) {
        if (error instanceof OpenAI.APIConnectionError) {
          throw new RetryableError(`OpenAI connection failed: ${error.message}`);
        }
        if (error instanceof OpenAI.APIError) {
          throw classifyStatus(
            error.status,
            `OpenAI ${error.status}: ${error.message}`,
            error.code,
            error.type,
          );
        }
        throw error;
      }
    },
  };
}
