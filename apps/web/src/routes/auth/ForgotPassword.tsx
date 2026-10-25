import { forgotPasswordSchema } from "@calabrain/shared";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { FormAlert, Spinner, TextField } from "../../components/ui.tsx";
import { authClient, authErrorMessage } from "../../lib/auth-client.ts";
import { validate } from "../../lib/forms.ts";
import { AuthLayout } from "./AuthLayout.tsx";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate(forgotPasswordSchema, { email });
    if (!v.ok) return setFieldError(v.fields.email);
    setFieldError(undefined);
    setPending(true);
    const { error } = await authClient.requestPasswordReset({
      email: v.data.email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setPending(false);
    if (error) return setError(authErrorMessage(error));
    setSentTo(v.data.email);
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll e-mail you a link to choose a new one."
      footer={
        <Link to="/sign-in" className="font-medium text-ink underline underline-offset-3">
          Back to sign in
        </Link>
      }
    >
      {sentTo ? (
        <FormAlert tone="success">
          If {sentTo} has an account, a reset link is on its way. It expires in 1 hour; check your spam folder too.
        </FormAlert>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {error ? <FormAlert>{error}</FormAlert> : null}
          <TextField
            label="E-mail"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            value={email}
            error={fieldError}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" className="btn btn-primary mt-2 w-full" disabled={pending}>
            {pending ? <Spinner /> : null}
            Send reset link
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
