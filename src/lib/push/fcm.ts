// ================================================================
// Firebase Cloud Messaging (HTTP v1) sender. SERVER ONLY.
//
// FCM delivers to Android directly and to iOS through APNs (once an
// APNs key is uploaded in the Firebase console), so one sender covers
// both. Auth is a Google OAuth token minted from the Firebase service
// account in FIREBASE_SERVICE_ACCOUNT (the downloaded JSON, pasted
// whole) — signed here with node:crypto so no Google SDK is needed.
// ================================================================

import { createSign } from "node:crypto";

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let cachedToken: { value: string; expiresAt: number } | null = null;

function serviceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_UNCONFIGURED");
  return JSON.parse(raw) as ServiceAccount;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

async function accessToken(sa: ServiceAccount): Promise<string> {
  // Tokens last an hour; refresh with a minute to spare. Warm serverless
  // instances reuse this across requests.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`FIREBASE_AUTH_FAILED ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export type PushMessage = { title: string; body?: string | null; url: string };

// "dead" = FCM says this token will never work again (app uninstalled,
// token rotated) — the caller deletes it. Anything else is transient.
export type PushResult = "sent" | "dead" | "failed";

export async function sendPush(token: string, msg: PushMessage): Promise<PushResult> {
  const sa = serviceAccount();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: msg.title, ...(msg.body ? { body: msg.body } : {}) },
        data: { url: msg.url },
        android: {
          priority: "high",
          notification: { channel_id: "default", color: "#006241", icon: "ic_stat_notification" },
        },
        apns: { payload: { aps: { sound: "default" } } },
      },
    }),
    cache: "no-store",
  });
  if (res.ok) return "sent";
  if (res.status === 404) return "dead";
  const err = await res.json().catch(() => null) as { error?: { details?: { errorCode?: string }[] } } | null;
  const code = err?.error?.details?.find((d) => d.errorCode)?.errorCode;
  return code === "UNREGISTERED" || code === "INVALID_ARGUMENT" ? "dead" : "failed";
}
