import { PASSWORD_MIN, signUpSchema } from "@calabrain/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { FormAlert, Spinner, TextField } from "../../components/ui.tsx";
import { authClient, authErrorMessage } from "../../lib/auth-client.ts";
import { validate } from "../../lib/forms.ts";
import { meQuery } from "../../lib/session.ts";
import { AuthLayout } from "./AuthLayout.tsx";

export function SignUp() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate(signUpSchema, values);
    if (!v.ok) return setFields(v.fields);
    setFields({});
    setPending(true);
    const { error } = await authClient.signUp.email(v.data);
    setPending(false);
    if (error) return setError(authErrorMessage(error));
    await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
    await navigate({ to: "/" });
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Organize what you study, then explain it in your own words."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/sign-in" className="font-medium text-ink underline underline-offset-3">
            Sign in
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <TextField
          label="Name"
          name="name"
          autoComplete="name"
          autoFocus
          value={values.name}
          error={fields.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
        />
        <TextField
          label="E-mail"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={values.email}
          error={fields.email}
          onChange={(e) => setValues({ ...values, email: e.target.value })}
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN} characters. A short phrase works well.`}
          value={values.password}
          error={fields.password}
          onChange={(e) => setValues({ ...values, password: e.target.value })}
        />
        <button type="submit" className="btn btn-primary mt-2 w-full" disabled={pending}>
          {pending ? <Spinner /> : null}
          Create account
        </button>
      </form>
    </AuthLayout>
  );
}
