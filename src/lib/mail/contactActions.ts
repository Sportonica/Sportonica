"use server";

import { sendMail } from "./mailer";
import { captchaPassed, clientIp, underRateLimit } from "@/lib/security/abuse";

export interface ContactFormInput {
  name: string;
  email: string;
  subject: string;
  message: string;
  captchaToken?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Every message spends the shared Brevo quota that password resets and
// booking emails also depend on, so the form is CAPTCHA-checked, rate
// limited per IP and length-capped (security audit, RATE_LIMITING).
const LIMITS = { name: 100, email: 200, subject: 150, message: 5000 };
const PER_IP_PER_HOUR = 5;

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
  if (name.length > LIMITS.name || email.length > LIMITS.email || subject.length > LIMITS.subject || message.length > LIMITS.message) {
    return { ok: false, error: `Please keep your message under ${LIMITS.message.toLocaleString()} characters.` };
  }
  if (!(await captchaPassed(input.captchaToken))) {
    return { ok: false, error: "Couldn't confirm you're not a bot. Refresh the page and try again." };
  }
  if (!(await underRateLimit("contact-ip", await clientIp(), PER_IP_PER_HOUR, 60 * 60))) {
    return { ok: false, error: "You've sent a few messages already. Please wait an hour, or email info@sportonica.com directly." };
  }

  await sendMail({
    to: "info@sportonica.com",
    subject: `[Contact form] ${subject || "New message"} from ${name}`,
    body: `From: ${name} <${email}>\n\n${message}`,
  });

  return { ok: true };
}
