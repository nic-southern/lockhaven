import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_PRODUCT_NAME,
  getClientProductName,
  getServerProductName,
  getProductInitials,
} from "./product-name"

test("uses Lockhaven as the default product name", () => {
  assert.equal(DEFAULT_PRODUCT_NAME, "Lockhaven")
  assert.equal(getServerProductName({}), "Lockhaven")
})

test("uses the deployed product name when configured", () => {
  assert.equal(
    getServerProductName({ PRODUCT_NAME: "Acme Access" }),
    "Acme Access"
  )
})

test("ignores blank deployed product names", () => {
  assert.equal(getServerProductName({ PRODUCT_NAME: "   " }), "Lockhaven")
})

test("reads the injected browser product name", () => {
  assert.equal(
    getClientProductName({ productName: "Customer Portal" }),
    "Customer Portal"
  )
})

test("creates readable initials from the product name", () => {
  assert.equal(getProductInitials("Lockhaven"), "L")
  assert.equal(getProductInitials("Acme Access"), "AA")
})
