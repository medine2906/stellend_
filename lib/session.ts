import "server-only";
import { cookies } from "next/headers";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

const SESSION_COOKIE = "stellend_session";
const PLACEHOLDER_SECRET = "change-me-in-production";
const MIN_SECRET_LENGTH = 32;

export interface SessionData {
  jwt: string;
  publicKey: string;
}

const IV_LENGTH = 12;

function key(): Buffer {
  const secret = env.SESSION_COOKIE_SECRET;
  // A guessable signing key means anyone can mint a session for any wallet, so production
  // refuses to start rather than run with one. Development keeps the placeholder working.
  if (process.env.NODE_ENV === "production") {
    if (secret === PLACEHOLDER_SECRET || secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        "SESSION_COOKIE_SECRET must be set to a random value of at least " +
          `${MIN_SECRET_LENGTH} characters in production (generate one with \`openssl rand -base64 32\`)`,
      );
    }
  }
  return createHash("sha256").update(secret).digest();
}

/**
 * The cookie carries the anchor's SEP-10 bearer token, which is a credential in its own
 * right — anyone holding it can talk to the anchor as this user. So the value is
 * encrypted, not merely signed: AES-256-GCM, whose authentication tag also makes any
 * tampering detectable.
 *
 * Cookie value is `<iv>.<ciphertext>.<tag>`, all base64url.
 */
function serialize(data: SessionData): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return [iv, ciphertext, cipher.getAuthTag()].map((part) => part.toString("base64url")).join(".");
}

function deserialize(raw: string): SessionData | null {
  const [ivPart, ciphertextPart, tagPart] = raw.split(".");
  if (!ivPart || !ciphertextPart || !tagPart) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextPart, "base64url")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as SessionData;
  } catch {
    // Wrong key, tampered value, or a cookie from before this format — all mean "no session".
    return null;
  }
}

export async function setSessionCookie(data: SessionData) {
  const store = await cookies();
  store.set(SESSION_COOKIE, serialize(data), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24h, matches typical SEP-10 JWT lifetime
  });
}

export async function getSession(): Promise<SessionData | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return deserialize(raw);
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
