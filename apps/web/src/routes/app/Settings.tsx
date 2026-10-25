import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { FormAlert, Spinner } from "../../components/ui.tsx";
import { authClient } from "../../lib/auth-client.ts";
import { meQuery } from "../../lib/session.ts";

export function Settings() {
  const { data: me } = useSuspenseQuery(meQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function signOut() {
    setPending(true);
    const { error } = await authClient.signOut();
    setPending(false);
    if (error) return setError(true);
    queryClient.setQueryData(meQuery.queryKey, null);
    queryClient.clear();
    await navigate({ to: "/sign-in" });
  }

  const since = me ? new Date(me.createdAt).toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric" }) : "";

  return (
    <>
      <h1 className="rise text-[28px] leading-9 font-medium tracking-[-0.01em]" style={{ "--i": 0 } as CSSProperties}>
        Settings
      </h1>
      <section className="panel rise mt-6 max-w-[640px] p-5 sm:p-6" style={{ "--i": 1 } as CSSProperties} aria-labelledby="account-title">
        <h2 id="account-title" className="text-lg leading-6 font-medium">
          Account
        </h2>
        <dl className="mt-4 divide-y divide-border text-[13px] leading-[18px]">
          {[
            ["Name", me?.name],
            ["E-mail", me?.email],
            ["Member since", since],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-3">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="min-w-0 truncate font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {error ? (
          <div className="mt-4">
            <FormAlert>We couldn't sign you out. Check your connection and try again.</FormAlert>
          </div>
        ) : null}
        <button type="button" className="btn btn-secondary mt-5" onClick={signOut} disabled={pending}>
          {pending ? <Spinner /> : <LogOut size={16} strokeWidth={1.75} aria-hidden />}
          Sign out
        </button>
      </section>
    </>
  );
}
