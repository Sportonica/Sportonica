// SERVER ONLY. Sends SMS for phone verification (SEC-03).
//
// Provider-agnostic on purpose: pick one with SMS_PROVIDER and add its
// case to sendSms(). Until one is set, phone verification is switched
// off everywhere (smsEnabled() is false) and phone numbers are saved
// unverified, exactly as before — they just can't claim walk-in
// tournament entries.
//
//   SMS_PROVIDER=console   local development only: the message is
//                          printed to the server log instead of sent.
//
// A real provider is a POST to its HTTP API with a token from env, e.g.
//   case "sparrow": return postForm("https://api.sparrowsms.com/v2/sms/",
//     { token: process.env.SMS_TOKEN!, from: process.env.SMS_FROM!, to, text });

const provider = () => process.env.SMS_PROVIDER?.trim().toLowerCase() || "";

export function smsEnabled(): boolean {
  const p = provider();
  if (!p) return false;
  if (p === "console") return process.env.NODE_ENV !== "production";
  return true;
}

export async function sendSms(to: string, text: string): Promise<boolean> {
  if (!smsEnabled()) return false;
  switch (provider()) {
    case "console":
      console.info(`[sms:console] to ${to}: ${text}`);
      return true;
    default:
      console.error(`[sms] unknown SMS_PROVIDER "${provider()}"`);
      return false;
  }
}
