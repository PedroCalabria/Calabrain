import { PASSWORD_MIN, resetPasswordSchema } from "@calabrain/shared";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { FormAlert, Spinner, TextField } from "../../components/ui.tsx";
import { authClient, authErrorMessage } from "../../lib/auth-client.ts";
import { validate } from "../../lib/forms.ts";
import { AuthLayout } from "./AuthLayout.tsx";

export function ResetPassword() {
  const { token } = useSearch({ strict: false }) as { token?: string };
  const navigate = useNavigate();
  const [values, setValues] = useState({ password: "", confirm: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <AuthLayout title="This link isn't valid" footer={<Link to="/forgot-password" className="font-medium text-ink underline underline-offset-3">Ask for a new link</Link>}>
        <FormAlert>The reset link is missing its code. Open the link from the e-mail again, or ask for a new one.</FormAlert>
      </AuthLayout>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate(resetPasswordSchema, values);
    if (!v.ok) return setFields(v.fields);
    setFields({});
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword: v.data.password, token });
    setPending(false);
    if (error) return setError(authErrorMessage(error));
    await navigate({ to: "/sign-in", search: { reset: "done" } });
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="You'll be signed out of your other devices."
      footer={
        <Link to="/sign-in" className="font-medium text-ink underline underline-offset-3">
          Back to sign in
        </Link>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <TextField
          label="New password"
          type="password"
          name="password"
          autoComplete="new-password"
          autoFocus
          hint={`At least ${PASSWORD_MIN} characters.`}
          value={values.password}
          error={fields.password}
          onChange={(e) => setValues({ ...values, password: e.target.value })}
        />
        <TextField
          label="Repeat the new password"
          type="password"
          name="confirm"
          autoComplete="new-password"
          value={values.confirm}
          error={fields.confirm}
          onChange={(e) => setValues({ ...values, confirm: e.target.value })}
        />
        <button type="submit" className="btn btn-primary mt-2 w-full" disabled={pending}>
          {pending ? <Spinner /> : null}
          Save new password
        </button>
      </form>
    </AuthLayout>
  );
}
