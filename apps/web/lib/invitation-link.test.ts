import assert from "node:assert/strict"
import test from "node:test"

import {
  invitationEmailTakenMessage,
  invitationInvalidMessage,
} from "@nms/shared"

import {
  invitationAcceptErrorMessage,
  invitationAcceptFallbackMessage,
  inviteAcceptView,
  inviteTokenIsWellFormed,
} from "./invitation-link"

test("malformed invite tokens fail before lookup", () => {
  assert.equal(inviteTokenIsWellFormed(""), false)
  assert.equal(inviteTokenIsWellFormed("short-token"), false)
  assert.equal(inviteTokenIsWellFormed("a".repeat(19)), false)
  assert.equal(inviteTokenIsWellFormed("a".repeat(20)), true)
  assert.equal(inviteTokenIsWellFormed("a".repeat(200)), true)
  assert.equal(inviteTokenIsWellFormed("a".repeat(201)), false)
})

test("closed and failed previews show the invalid invitation state", () => {
  assert.equal(
    inviteAcceptView({
      token: "short",
      previewValid: null,
      previewFailed: false,
    }),
    "invalid"
  )
  assert.equal(
    inviteAcceptView({
      token: "a".repeat(201),
      previewValid: null,
      previewFailed: false,
    }),
    "invalid"
  )
  assert.equal(
    inviteAcceptView({
      token: "a".repeat(32),
      previewValid: null,
      previewFailed: true,
    }),
    "invalid"
  )
  assert.equal(
    inviteAcceptView({
      token: "a".repeat(32),
      previewValid: false,
      previewFailed: false,
    }),
    "invalid"
  )
  assert.equal(
    inviteAcceptView({
      token: "a".repeat(32),
      previewValid: null,
      previewFailed: false,
    }),
    "checking"
  )
  assert.equal(
    inviteAcceptView({
      token: "a".repeat(32),
      previewValid: true,
      previewFailed: false,
    }),
    "form"
  )
})

test("accept failures stay in product language", () => {
  assert.equal(
    invitationAcceptErrorMessage(new Error(invitationInvalidMessage)),
    invitationInvalidMessage
  )
  assert.equal(
    invitationAcceptErrorMessage(new Error(invitationEmailTakenMessage)),
    invitationEmailTakenMessage
  )
  assert.equal(
    invitationAcceptErrorMessage(
      new Error(
        'duplicate key value violates unique constraint "user_email_unique"'
      )
    ),
    invitationAcceptFallbackMessage
  )
  assert.equal(
    invitationAcceptErrorMessage(
      new Error("invalid input syntax for type uuid")
    ),
    invitationAcceptFallbackMessage
  )
  assert.equal(
    invitationAcceptErrorMessage("nope"),
    invitationAcceptFallbackMessage
  )
})
