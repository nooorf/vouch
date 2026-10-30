import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { decodeSession, encodeSession } from "./token";

const COOKIE = "vouch_session";
const MAX_AGE_SECONDS = 7 * 24 * 3600;

/** Call from Server Actions or Route Handlers only (cookies can't be set while rendering). */
export async function startSession(uid: string, demo: boolean) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  (await cookies()).set(COOKIE, encodeSession({ uid, demo, exp }, env().AUTH_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export type CurrentUser = typeof schema.users.$inferSelect & { demo: boolean };

/** The signed-in user, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = decodeSession((await cookies()).get(COOKIE)?.value, env().AUTH_SECRET);
  if (!session) return null;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.uid));
  return user ? { ...user, demo: session.demo } : null;
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/?signin=required");
  return user;
}
