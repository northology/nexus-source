import { useState } from 'react';
import type { GateAnswers } from '../../../core/types.ts';
import { ApiError, type AnswerBody, type Client } from '../api/client.ts';

/**
 * Sends one gate's answer. After a successful send, `sent` holds the answer and `sending` stays true: the caller
 * stays locked until the reloaded snapshot shows the answer. A gate already answered elsewhere says so and reloads.
 */
export function useAnswer(
  client: Client,
  build: string,
  gate: string,
  refresh: () => void,
): { submit: (body: AnswerBody) => Promise<void>; sending: boolean; error: string | null; sent: GateAnswers | null } {
  const [sent, setSent] = useState<GateAnswers | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(body: AnswerBody): Promise<void> {
    setSending(true);
    setError(null);
    try {
      setSent(await client.submit(build, gate, body));
      refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('This gate was already answered, perhaps in another tab. The recorded answer is shown below.');
        refresh();
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      setSending(false);
    }
  }

  return { submit, sending, error, sent };
}
