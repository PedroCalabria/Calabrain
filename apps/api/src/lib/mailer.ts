import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env.ts";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Messages "sent" while MAIL_TRANSPORT=memory (tests read them from here). */
export const outbox: Mail[] = [];

let transporter: Transporter | null = null;
function smtp(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (env.MAIL_TRANSPORT === "memory") {
    outbox.push(mail);
    return;
  }
  await smtp().sendMail({ from: env.MAIL_FROM, ...mail });
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function resetPasswordMail(to: string, name: string, url: string): Mail {
  const text = [
    `Hi ${name},`,
    "",
    "Someone asked to reset the password of your Calabrain account.",
    "Open this link to choose a new one. It expires in 1 hour:",
    url,
    "",
    "If it wasn't you, ignore this e-mail; your password stays the same.",
  ].join("\n");
  const html = `<p>Hi ${escape(name)},</p>
<p>Someone asked to reset the password of your Calabrain account. Open this link to choose a new one. It expires in 1 hour.</p>
<p><a href="${escape(url)}">Choose a new password</a></p>
<p>If it wasn't you, ignore this e-mail; your password stays the same.</p>`;
  return { to, subject: "Reset your Calabrain password", text, html };
}
