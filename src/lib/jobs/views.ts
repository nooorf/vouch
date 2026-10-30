import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

export type MilestoneRow = typeof schema.milestones.$inferSelect;
export type EvaluationRow = typeof schema.evaluations.$inferSelect;
export type DeliveryRow = typeof schema.deliveries.$inferSelect;

/** Milestones with their current evaluation and delivery, in order. */
export async function milestonesWithEvaluations(jobId: string) {
  const milestones = await db.select().from(schema.milestones).where(eq(schema.milestones.jobId, jobId)).orderBy(asc(schema.milestones.position));
  const evalIds = milestones.map((m) => m.currentEvaluationId).filter((id): id is string => Boolean(id));
  const evaluations = evalIds.length ? await db.select().from(schema.evaluations).where(inArray(schema.evaluations.id, evalIds)) : [];
  const deliveryIds = evaluations.map((e) => e.deliveryId);
  const deliveries = deliveryIds.length ? await db.select().from(schema.deliveries).where(inArray(schema.deliveries.id, deliveryIds)) : [];
  return milestones.map((m) => {
    const ev = evaluations.find((e) => e.id === m.currentEvaluationId) ?? null;
    const delivery = ev ? (deliveries.find((d) => d.id === ev.deliveryId) ?? null) : null;
    return { m, ev, delivery };
  });
}
