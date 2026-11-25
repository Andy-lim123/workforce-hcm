"use client";

import { useActionState } from "react";
import { ConfirmSubmit, FormMessage, SubmitButton } from "@/components/action-form";
import { buttonClass } from "@/components/ui";
import { checkTelegramLink, startTelegramLink, unlinkTelegram } from "./actions";

// One component for both states, so a success or error message survives the page refresh after linking or unlinking.
// A success message is shown only while it is still true (a later disconnect hides "connected", and the reverse).
export function TelegramLinkPanel({ linked, configured }: { linked: boolean; configured: boolean }) {
  const [started, start] = useActionState(startTelegramLink, {});
  const [checked, check] = useActionState(checkTelegramLink, {});
  const [unlinked, unlink] = useActionState(unlinkTelegram, {});

  return (
    <div className="space-y-4">
      <div>
        {(checked.success ? linked : !linked) && <FormMessage state={checked} />}
        {(unlinked.success ? !linked : linked) && <FormMessage state={unlinked} />}
      </div>

      {linked ? (
        <form action={unlink}>
          <ConfirmSubmit
            label="Disconnect Telegram"
            title="Disconnect Telegram?"
            message="You will stop receiving Telegram messages from this app. You can connect again later."
            confirmLabel="Disconnect"
          />
        </form>
      ) : configured ? (
        <>
          <form action={start}>
            <FormMessage state={started} />
            {started.link && (
              <p className="mb-3">
                <a href={started.link} target="_blank" rel="noopener noreferrer" className={buttonClass.primary}>
                  Open Telegram
                </a>
              </p>
            )}
            <SubmitButton pendingText="Preparing…" variant={started.link ? "secondary" : "primary"}>
              {started.link ? "Get a new link" : "Connect Telegram"}
            </SubmitButton>
          </form>
          <form action={check}>
            <SubmitButton pendingText="Checking…" variant="secondary">
              Check connection
            </SubmitButton>
          </form>
        </>
      ) : (
        <p className="text-sm text-zinc-600">Telegram is not set up yet. Ask your administrator.</p>
      )}
    </div>
  );
}
