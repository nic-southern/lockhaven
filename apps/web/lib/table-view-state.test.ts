import assert from "node:assert/strict"
import test from "node:test"

import {
  paramsToViewState,
  viewStateToParams,
  type TableViewState,
} from "./table-view-state"

const defaults: TableViewState = {
  sorting: [{ id: "lastSeenAt", desc: true }],
  columnFilters: [],
  search: "",
  columnVisibility: { status: false },
}

test("default view serializes to an empty query", () => {
  assert.equal(viewStateToParams(defaults, defaults).toString(), "")
  assert.deepEqual(paramsToViewState(new URLSearchParams(), defaults), defaults)
})

test("show-archived choice survives a link round trip", () => {
  const showing: TableViewState = {
    ...defaults,
    columnFilters: [{ id: "archived", value: ["all"] }],
  }
  const params = viewStateToParams(showing, defaults)
  assert.equal(params.get("f.archived"), "all")
  assert.deepEqual(paramsToViewState(params, defaults), showing)
})

test("archived-only view keeps its own filter value", () => {
  const params = new URLSearchParams("f.archived=yes&sort=displayName:asc")
  const state = paramsToViewState(params, defaults)
  assert.deepEqual(state.columnFilters, [{ id: "archived", value: ["yes"] }])
  assert.deepEqual(state.sorting, [{ id: "displayName", desc: false }])
})
