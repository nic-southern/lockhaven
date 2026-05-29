import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_PRODUCT_NAME,
  getClientProductName,
  getClientSocEnrollmentPassword,
  getClientSocBaseUrl,
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

test("reads and normalizes the injected SOC host", () => {
  assert.equal(
    getClientSocBaseUrl({ socBaseUrl: "soc.example.com/" }),
    "https://soc.example.com"
  )
})

test("returns null when no SOC host is configured", () => {
  assert.equal(getClientSocBaseUrl({}), null)
})

test("reads the injected SOC enrollment password", () => {
  assert.equal(
    getClientSocEnrollmentPassword({ socEnrollmentPassword: "  secret  " }),
    "secret"
  )
})

test("returns null when no SOC enrollment password is configured", () => {
  assert.equal(getClientSocEnrollmentPassword({}), null)
})

test("creates readable initials from the product name", () => {
  assert.equal(getProductInitials("Lockhaven"), "L")
  assert.equal(getProductInitials("Acme Access"), "AA")
})
