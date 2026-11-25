"use client";

import { useState } from "react";
import { ConfirmSubmit } from "@/components/action-form";
import { buttonClass, inputClass } from "@/components/ui";
import { REASON_MAX, validateReason } from "@/lib/scheduling";

export type OverrideWarning = { rule: string; label: string; message: string };

// Fields for overriding warnings, rendered inside the row's ActionForm. The browser only collects one reason per warning and
// helps the admin get them right; the Server Action recomputes the warnings from fresh data and accepts an override only
// when the submitted reasons cover exactly those warnings. It never reads a rule id or a detail from here.
export function OverrideFields({
  name,
  warnings,
  fingerprint,
  published,
}: {
  name: string;
  warnings: OverrideWarning[];
  fingerprint: string;
  published: boolean;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const checks = warnings.map((w) => ({ w, check: validateReason(reasons[w.rule] ?? "") }));
  const allValid = checks.every((c) => c.check.ok);
  const summary = checks
    .map(({ w, check }) => `${w.label}: “${check.ok ? check.reason : ""}”`)
    .join(" · ");
  const plural = warnings.length === 1 ? "warning" : "warnings";

  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <input type="hidden" name="fingerprint" value={fingerprint} />
      <input type="hidden" name="shown_rules" value={warnings.map((w) => w.rule).join(",")} />
      {published && <input type="hidden" name="published_ack" value="yes" />}

      <p className="text-xs text-amber-900">
        To assign {name} anyway, give a reason for each warning. Reasons are recorded permanently with your name, the time and the
        warning text, and cannot be edited or deleted.
      </p>

      {checks.map(({ w, check }) => {
        const id = `reason-${fingerprint.slice(0, 8)}-${w.rule}`;
        const showError = touched[w.rule] && !check.ok;
        return (
          <div key={w.rule}>
            <label htmlFor={id} className="block text-xs font-medium text-zinc-900">
              {w.label}
              <span className="block font-normal text-zinc-600">{w.message}</span>
            </label>
            <textarea
              id={id}
              name={`reason_${w.rule}`}
              rows={2}
              maxLength={REASON_MAX}
              value={reasons[w.rule] ?? ""}
              onChange={(e) => setReasons((r) => ({ ...r, [w.rule]: e.target.value }))}
              onBlur={() => setTouched((t) => ({ ...t, [w.rule]: true }))}
              aria-invalid={showError ? true : undefined}
              aria-describedby={showError ? `${id}-error` : undefined}
              placeholder="Why is this acceptable? (10–500 characters)"
              className={`${inputClass} mt-1 text-sm`}
            />
            {showError && !check.ok && (
              <p id={`${id}-error`} className="mt-0.5 text-xs text-red-600">
                {check.error}
              </p>
            )}
          </div>
        );
      })}

      {allValid ? (
        <ConfirmSubmit
          label="Assign with override"
          variant="secondary"
          tone="primary"
          title={`Assign ${name} despite ${warnings.length} ${plural}?`}
          message={
            `You are overriding: ${summary}. These reasons are recorded permanently with your name and the time. ` +
            (published ? `${name} will see this shift immediately. ` : "") +
            "Assignments cannot be removed in this version."
          }
          confirmLabel="Assign with override"
        />
      ) : (
        <button type="button" disabled className={buttonClass.secondary}>
          Assign with override
        </button>
      )}
    </div>
  );
}
