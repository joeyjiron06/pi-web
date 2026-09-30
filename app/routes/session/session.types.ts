import { z } from "zod";
import { zfd } from "zod-form-data";
import { ATTACHMENT_FIELD_NAME } from "~/lib/attachments";
import { isModelRef } from "~/lib/model-ref";
import { THINKING_LEVELS } from "~/routes/home/home.types";

/**
 * What the session page submits: a prompt (with the model/thinking level the
 * pickers are currently showing), an abort of the running turn, or a close of
 * the whole session.
 *
 * Deliberately *not* a `z.discriminatedUnion("intent", ...)`: zod can't
 * discriminate on a key that is absent from the input, and a `.default()` on a
 * discriminator isn't supported -- and absent is precisely the Enter-key case
 * (see below). Flat fields + superRefine it is.
 */
export const sessionPromptSchema = zfd
  .formData({
    /**
     * Absent when the textarea submits via Enter: `requestSubmit()` is called
     * with no submitter, so the send button's name/value pair never makes it
     * into the FormData. That absence is *meaningful* -- it means "prompt",
     * never "abort", otherwise pressing Enter mid-stream would kill the agent
     * turn. Do not "fix" this with a hidden field.
     */
    intent: zfd.text(
      z.enum(["prompt", "abort", "close", "clear-queue"]).default("prompt"),
    ),

    /**
     * Which queue the message joins when the agent is already streaming.
     * Ignored by pi when it is idle, in which case the message sends straight
     * away -- which is exactly what plain Enter and Alt+Enter should both do.
     *
     * Defaults to "steer" so a client that never sends the field keeps the old
     * behaviour.
     */
    deliverAs: zfd.text(z.enum(["steer", "followUp"]).default("steer")),

    /**
     * Where to send the browser after a close. Only sent when closing the
     * session currently on screen; omitted means "stay put".
     */
    redirectTo: zfd.text(z.string().optional()),

    // required for intent=prompt, checked in superRefine; meaningless for abort
    prompt: zfd.text(z.string().optional()),
    modelRef: zfd.text(z.string().optional()),
    thinkingLevel: zfd.text(z.enum(THINKING_LEVELS).optional()),

    /**
     * Files from the composer. Not `zfd.file()`: that helper rewrites a
     * zero-byte File to `undefined`, which then fails the array's element
     * check instead of simply being absent -- and an empty file input submits
     * exactly that. Empties are filtered here instead.
     */
    [ATTACHMENT_FIELD_NAME]: zfd
      .repeatable(z.array(z.instanceof(File)))
      .transform((files) => files.filter((file) => file.size > 0)),
  })
  .superRefine((value, ctx) => {
    if (value.intent !== "prompt") return;

    if (!value.prompt?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["prompt"],
        message: "Enter a prompt",
      });
    }

    // a canonical `provider/id` ref (see `~/lib/model-ref`), not a bare id: the
    // id alone doesn't identify a model. Catching the shape here stops a stale
    // client from silently switching the session onto the wrong model.
    if (!value.modelRef || !isModelRef(value.modelRef)) {
      ctx.addIssue({
        code: "custom",
        path: ["modelRef"],
        message: "Select a model",
      });
    }

    if (!value.thinkingLevel) {
      ctx.addIssue({
        code: "custom",
        path: ["thinkingLevel"],
        message: "Select a thinking level",
      });
    }
  });

export type SessionPromptInput = z.infer<typeof sessionPromptSchema>;

export type SessionPromptSuccess = {
  ok: true;
  /**
   * Messages pulled back out of the queue by an abort or a clear, for the page
   * to restore into the composer. Absent for a normal prompt.
   */
  restored?: string[];
};

export type SessionPromptFailure = {
  ok: false;
  /** messages that aren't tied to a single field */
  formErrors: string[];
  fieldErrors: Record<string, string[]>;
};

export type SessionPromptResult = SessionPromptSuccess | SessionPromptFailure;
