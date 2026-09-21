"use server";

import { sendMail } from "./mailer";

export interface ContactFormInput {
  name: string;
  email: string;
  subject: string;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function submitContactForm(
  input: ContactFormInput
): Promise<{ ok: boolean; error?: string }> {
  const name = input.name.trim();
  const email = input.email.trim();
  const subject = input.subject.trim();
  const message = input.message.trim();

  if (!name || !email || !message) {
    return { ok: false, error: "Please fill in your name, email, and message." };
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "That email address doesn't look right." };
  }

  await sendMail({
    to: "info@sportonica.com",
    subject: `[Contact form] ${subject || "New message"} from ${name}`,
    body: `From: ${name} <${email}>\n\n${message}`,
  });

  return { ok: true };
}
