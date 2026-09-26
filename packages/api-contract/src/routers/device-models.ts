import { TRPCError } from "@trpc/server"
import { desc, eq } from "drizzle-orm"
import { z } from "zod"

import { deviceModels } from "@nms/db"
import { deviceModelInputSchema } from "@nms/shared"

import { assertAuthorized } from "../access"
import { writeAuditEvent } from "../audit"
import { createTRPCRouter, permissionProcedure } from "../trpc"

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function publicModel(row: typeof deviceModels.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    manufacturer: row.manufacturer,
    model: row.model,
    notes: row.notes,
    purchaseCost: row.purchaseCost,
    replacementCost: row.replacementCost,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    label: row.manufacturer
      ? `${row.name} · ${row.manufacturer} ${row.model}`
      : `${row.name} · ${row.model}`,
  }
}

export const deviceModelsRouter = createTRPCRouter({
  list: permissionProcedure("device:view")
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "device:view", {
        kind: "organization",
        organizationId: input.organizationId,
      })
      const rows = await ctx.db
        .select()
        .from(deviceModels)
        .where(eq(deviceModels.organizationId, input.organizationId))
        .orderBy(desc(deviceModels.createdAt))
      return rows.map(publicModel)
    }),
  create: permissionProcedure("organization:admin")
    .input(deviceModelInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: input.organizationId,
      })
      try {
        const [record] = await ctx.db
          .insert(deviceModels)
          .values({
            organizationId: input.organizationId,
            name: input.name.trim(),
            manufacturer: emptyToNull(input.manufacturer),
            model: input.model.trim(),
            notes: emptyToNull(input.notes),
            purchaseCost: input.purchaseCost ?? null,
            replacementCost: input.replacementCost ?? null,
          })
          .returning()
        await writeAuditEvent(ctx, {
          eventType: "device_model_created",
          organizationId: input.organizationId,
          eventData: { id: record.id, name: record.name },
        })
        return publicModel(record)
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A device model with that name already exists.",
          })
        }
        throw error
      }
    }),
  update: permissionProcedure("organization:admin")
    .input(
      deviceModelInputSchema.partial().extend({
        id: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(deviceModels)
        .where(eq(deviceModels.id, input.id))
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: existing.organizationId,
      })
      try {
        const [record] = await ctx.db
          .update(deviceModels)
          .set({
            name: input.name?.trim() ?? existing.name,
            manufacturer:
              input.manufacturer !== undefined
                ? emptyToNull(input.manufacturer)
                : existing.manufacturer,
            model: input.model?.trim() ?? existing.model,
            notes:
              input.notes !== undefined
                ? emptyToNull(input.notes)
                : existing.notes,
            purchaseCost:
              input.purchaseCost !== undefined
                ? (input.purchaseCost ?? null)
                : existing.purchaseCost,
            replacementCost:
              input.replacementCost !== undefined
                ? (input.replacementCost ?? null)
                : existing.replacementCost,
            updatedAt: new Date(),
          })
          .where(eq(deviceModels.id, existing.id))
          .returning()
        await writeAuditEvent(ctx, {
          eventType: "device_model_updated",
          organizationId: existing.organizationId,
          eventData: { id: record.id, name: record.name },
        })
        return publicModel(record)
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A device model with that name already exists.",
          })
        }
        throw error
      }
    }),
  delete: permissionProcedure("organization:admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(deviceModels)
        .where(eq(deviceModels.id, input.id))
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: existing.organizationId,
      })
      await ctx.db.delete(deviceModels).where(eq(deviceModels.id, existing.id))
      await writeAuditEvent(ctx, {
        eventType: "device_model_deleted",
        organizationId: existing.organizationId,
        eventData: { id: existing.id, name: existing.name },
      })
      return { id: existing.id }
    }),
})
