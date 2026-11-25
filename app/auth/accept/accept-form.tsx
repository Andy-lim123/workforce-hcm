"use client";

import { useActionState, useSyncExternalStore } from "react";
import { Alert, buttonClass } from "@/components/ui";
import { acceptLink, type AuthFormState } from "../actions";

type Token = { tokenHash: string; type: string } | null;
let captured: Token | undefined;

// The token arrives in the URL fragment, which never reaches a server. Read it once, then strip
// it from the address bar and history so it cannot be copied or reused from there.
function readToken(): Token {
  if (captured === undefined) {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const tokenHash = params.get("token_hash");
    const type = params.get("type");
    captured = tokenHash && type ? { tokenHash, type } : null;
    if (window.location.hash) history.replaceState(null, "", window.location.pathname);
  }
  return captured;
}

export function AcceptForm() {
  const token = useSyncExternalStore(() => () => {}, readToken, () => undefined);
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(acceptLink, {});

  if (token === undefined) return <p className="text-sm text-zinc-500">Checking your link…</p>;
  if (token === null)
    return <Alert tone="error">This link is incomplete or has already been opened. Ask your administrator for a new one.</Alert>;

  // A button, not an automatic check, so link previewers that run scripts do not use up the token.
  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="token_hash" value={token.tokenHash} />
      <input type="hidden" name="type" value={token.type} />
      <button type="submit" disabled={pending} className={`${buttonClass.primary} w-full`}>
        {pending ? "Verifying…" : "Continue"}
      </button>
    </form>
  );
}
