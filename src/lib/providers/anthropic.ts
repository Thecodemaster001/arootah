import Anthropic from "@anthropic-ai/sdk";
import { TRIAGE_JSON_SCHEMA } from "../schema";
import { classifyStatus, type Prompt, type Provider } from "./types";

const DEFAULT_MODEL = "claude-opus-5";

/**
 * Structure is enforced with `output_config.format`, so the model is
 * constrained to the schema rather than merely asked for JSON.
 *
 * `effort: "low"` is deliberate: triage is classification, not deep reasoning,
 * and thinking is on by default on this model. `max_tokens` has to cover
 * thinking plus the response, which is why it is far larger than the ~150
 * tokens of JSON we actually want back.
 */
export function anthropicProvider(): Provider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (see .env.example)");

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });

  return {
    name: "anthropic",
    model,
    async complete(prompt: Prompt, signal?: AbortSignal): Promise<unknown> {
      try {
        const response = await client.messages.create(
          {
            model,
            max_tokens: 4096,
            system: prompt.system,
            messages: [{ role: "user", content: prompt.user }],
            output_config: {
              effort: "low",
              format: { type: "json_schema", schema: TRIAGE_JSON_SCHEMA },
            },
          },
          { signal },
        );

        if (response.stop_reason === "refusal") {
          throw new Error("Model declined to classify this message");
        }

        const text = response.content.find((block) => block.type === "text");
        if (!text || text.type !== "text") {
          throw new Error(`No text block in response (stop_reason: ${response.stop_reason})`);
        }
        return JSON.parse(text.text);
      } catch (error) {
        if (error instanceof Anthropic.APIError) {
          const code = typeof error.error === "object" && error.error !== null && "type" in error.error
            ? String((error.error as { type?: unknown }).type)
            : undefined;
          throw classifyStatus(error.status, `Anthropic ${error.status}: ${error.message}`, code);
        }
        throw error;
      }
    },
  };
}
