import { z } from "zod";

/** Password rule shown under the field and enforced by the API. */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Enter a valid e-mail address." }));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, { message: `Use at least ${PASSWORD_MIN} characters.` })
  .max(PASSWORD_MAX, { message: `Use at most ${PASSWORD_MAX} characters.` });

export const nameSchema = z
  .string()
  .trim()
  .min(1, { message: "Enter your name." })
  .max(80, { message: "Use at most 80 characters." });

export const signUpSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: "Enter your password." }),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "The passwords don't match.",
    path: ["confirm"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Shape returned by GET /me. */
export const meSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  createdAt: z.string(),
});
export type Me = z.infer<typeof meSchema>;
