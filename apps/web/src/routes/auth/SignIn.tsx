import { signInSchema } from "@calabrain/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { FormAlert, Spinner, TextField } from "../../components/ui.tsx";
import { authClient, authErrorMessage } from "../../lib/auth-client.ts";
import { validate } from "../../lib/forms.ts";
import { meQuery } from "../../lib/session.ts";
import { AuthLayout } from "./AuthLayout.tsx";

export function SignIn() {
  const search = useSearch({ strict: false }) as { redirect?: string; reset?: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ email: "", password: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate(signInSchema, values);
    if (!v.ok) return setFields(v.fields);
    setFields({});
    setPending(true);
    const { error } = await authClient.signIn.email(v.data);
    setPending(false);
    if (error) return setError(authErrorMessage(error));
    await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
    await navigate({ to: safeRedirect(search.redirect) });
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Pick up where you left off."
      footer={
        <>
          New here?{" "}
          <Link to="/sign-up" className="font-medium text-ink underline underline-offset-3">
            Create an account
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {search.reset === "done" ? <FormAlert tone="success">Password changed. Sign in with the new one.</FormAlert> : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
        <TextField
          label="E-mail"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          value={values.email}
          error={fields.email}
          onChange={(e) => setValues({ ...values, email: e.target.value })}
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={values.password}
          error={fields.password}
          onChange={(e) => setValues({ ...values, password: e.target.value })}
          trailing={
            <Link to="/forgot-password" className="text-xs text-ink-muted underline underline-offset-3 hover:text-ink">
              Forgot password?
            </Link>
          }
        />
        <button type="submit" className="btn btn-primary mt-2 w-full" disabled={pending}>
          {pending ? <Spinner /> : null}
          Sign in
        </button>
      </form>
    </AuthLayout>
  );
}

/** Only same-app paths are allowed as a post-login redirect. */
export function safeRedirect(target: string | undefined): string {
  if (!target || !target.startsWith("/") || target.startsWith("//")) return "/";
  return target;
}
