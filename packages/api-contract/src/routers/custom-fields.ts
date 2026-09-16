import { TRPCError } from "@trpc/server"
import { desc, eq } from "drizzle-orm"
import { z } from "zod"

import { customFieldDefinitions } from "@nms/db"
import { customFieldDefinitionInputSchema } from "@nms/shared"

import { assertAuthorized } from "../access"
import { writeAuditEvent } from "../audit"
import { createTRPCRouter, permissionProcedure } from "../trpc"

export const customFieldsRouter = createTRPCRouter({
  list: permissionProcedure("device:view")
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "device:view", {
        kind: "organization",
        organizationId: input.organizationId,
      })
      return ctx.db
        .select()
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.organizationId, input.organizationId))
        .orderBy(desc(customFieldDefinitions.createdAt))
    }),
  create: permissionProcedure("organization:admin")
    .input(customFieldDefinitionInputSchema)
    .mutation(async ({ ctx, input }) => {
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: input.organizationId,
      })
      if (input.fieldType === "select" && input.options.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "List fields need at least one option.",
        })
      }
      try {
        const [record] = await ctx.db
          .insert(customFieldDefinitions)
          .values({
            organizationId: input.organizationId,
            key: input.key,
            label: input.label,
            fieldType: input.fieldType,
            appliesTo: input.appliesTo,
            required: input.required,
            options: input.options,
          })
          .returning()
        await writeAuditEvent(ctx, {
          eventType: "custom_field_definition_created",
          organizationId: input.organizationId,
          eventData: { id: record.id, key: record.key },
        })
        return record
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A field with that key already exists.",
          })
        }
        throw error
      }
    }),
  update: permissionProcedure("organization:admin")
    .input(
      customFieldDefinitionInputSchema.partial().extend({
        id: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.id, input.id))
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: existing.organizationId,
      })
      const [record] = await ctx.db
        .update(customFieldDefinitions)
        .set({
          label: input.label ?? existing.label,
          fieldType: input.fieldType ?? existing.fieldType,
          appliesTo: input.appliesTo ?? existing.appliesTo,
          required: input.required ?? existing.required,
          options: input.options ?? existing.options,
          updatedAt: new Date(),
        })
        .where(eq(customFieldDefinitions.id, existing.id))
        .returning()
      await writeAuditEvent(ctx, {
        eventType: "custom_field_definition_updated",
        organizationId: existing.organizationId,
        eventData: { id: record.id, key: record.key },
      })
      return record
    }),
  delete: permissionProcedure("organization:admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.id, input.id))
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      assertAuthorized(ctx.actor, "organization:admin", {
        kind: "organization",
        organizationId: existing.organizationId,
      })
      await ctx.db
        .delete(customFieldDefinitions)
        .where(eq(customFieldDefinitions.id, existing.id))
      await writeAuditEvent(ctx, {
        eventType: "custom_field_definition_deleted",
        organizationId: existing.organizationId,
        eventData: { id: existing.id, key: existing.key },
      })
      return { id: existing.id }
    }),
})
