import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/placeholder";
import { Alert, Badge, Card, EmptyState } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { TelegramLinkPanel } from "./link-panel";

export const metadata: Metadata = { title: "Telegram" };

export default function Page() {
  return (
    <>
      <PageHeader title="Telegram" description="Connect your own Telegram account to this app." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Connection />
      </Suspense>
    </>
  );
}

async function Connection() {
  const user = await requireRole("employee");
  const supabase = await createClient();
  const { data: me, error: meError } = await supabase.from("employees").select("id").eq("profile_id", user.id).maybeSingle();
  if (meError) return <Alert tone="error">Could not load your account. Refresh the page to try again.</Alert>;
  if (!me)
    return <EmptyState title="Your account is not linked to an employee record yet" description="Ask your administrator to link your account first." />;

  // Only the columns a signed-in user may read: the chat id never reaches this page.
  const { data: link, error } = await supabase.from("employee_telegram").select("employee_id, linked_at").eq("employee_id", me.id).maybeSingle();
  if (error) return <Alert tone="error">Could not check your Telegram connection. Refresh the page to try again.</Alert>;

  // Server-side check only: the page learns whether the token exists, never its value.
  const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.SUPABASE_SECRET_KEY);

  return (
    <div className="max-w-xl">
      <Card title="Connection" action={<Badge tone={link ? "green" : "zinc"}>{link ? "Connected" : "Not connected"}</Badge>}>
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">
            {link
              ? `Connected since ${formatDateTime(link.linked_at)}.`
              : "Connecting proves the Telegram account is yours: you open a personal link, press Start in Telegram, then check the connection here."}{" "}
            Messages are sent here when your published shifts change, and as reminders your administrator sends.
          </p>
          <TelegramLinkPanel linked={Boolean(link)} configured={configured} />
        </div>
      </Card>
    </div>
  );
}
