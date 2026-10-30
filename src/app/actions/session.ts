"use server";

import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { endSession, startSession } from "@/lib/session";

/** "Try the demo": a fresh, private demo freelancer for every visitor, so judges never collide. */
export async function startDemo() {
  const [user] = await db
    .insert(schema.users)
    .values({
      name: "Sam Rivera",
      email: null,
      paypalEmail: process.env.PAYPAL_FREELANCER_EMAIL || null,
      isDemo: true,
    })
    .returning({ id: schema.users.id });
  await startSession(user.id, true);
  redirect("/dashboard");
}

export async function signOut() {
  await endSession();
  redirect("/");
}
