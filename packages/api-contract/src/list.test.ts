import assert from "node:assert/strict"
import test from "node:test"

import {
  decodeCursor,
  encodeCursor,
  likePattern,
  listQuerySchema,
  paginate,
  resolveListQuery,
} from "./list"

test("cursor round-trips an offset and tolerates garbage", () => {
  assert.equal(decodeCursor(encodeCursor(125)), 125)
  assert.equal(decodeCursor(undefined), 0)
  assert.equal(decodeCursor("not-a-cursor"), 0)
  assert.equal(decodeCursor(encodeCursor(-5)), 0)
})

test("listQuerySchema caps limits and validates shape", () => {
  assert.equal(listQuerySchema.safeParse({ limit: 500 }).success, false)
  assert.equal(listQuerySchema.safeParse({ limit: 0 }).success, false)
  const parsed = listQuerySchema.parse({
    limit: 25,
    sort: [{ id: "name" }],
    filters: { status: ["online", "offline"], site: "abc" },
    search: "  kiosk ",
  })
  assert.deepEqual(parsed.sort, [{ id: "name", desc: false }])
  assert.equal(parsed.search, "kiosk")
})

test("resolveListQuery normalizes filters and applies defaults", () => {
  const resolved = resolveListQuery(
    {
      filters: { status: ["online", " online ", ""], site: "s1" },
      cursor: encodeCursor(40),
    },
    { defaultLimit: 20 }
  )
  assert.equal(resolved.limit, 20)
  assert.equal(resolved.offset, 40)
  assert.deepEqual(resolved.filters, { status: ["online"], site: ["s1"] })
  assert.equal(resolved.search, "")

  const capped = resolveListQuery({ limit: 200 }, { maxLimit: 100 })
  assert.equal(capped.limit, 100)
})

test("paginate derives nextCursor from the overflow row", () => {
  const rows = [1, 2, 3, 4]
  const page = paginate(rows, { limit: 3, offset: 0 }, 10)
  assert.deepEqual(page.items, [1, 2, 3])
  assert.equal(page.total, 10)
  assert.equal(decodeCursor(page.nextCursor), 3)

  const last = paginate([7], { limit: 3, offset: 9 }, 10)
  assert.equal(last.nextCursor, null)
})

test("likePattern escapes wildcard characters", () => {
  assert.equal(likePattern("50%_off\\"), "%50\\%\\_off\\\\%")
})
