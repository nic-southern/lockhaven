import {
  INVITATION_TOKEN_MAX_LENGTH,
  INVITATION_TOKEN_MIN_LENGTH,
  invitationEmailTakenMessage,
  invitationInvalidMessage,
} from "@nms/shared"

const SAFE_ACCEPT_ERRORS = new Set([
  invitationInvalidMessage,
  invitationEmailTakenMessage,
  "Use at least 12 characters.",
])

export const invitationAcceptFallbackMessage =
  "We couldn't finish setting up your account."

export function inviteTokenIsWellFormed(token: string) {
  return (
    token.length >= INVITATION_TOKEN_MIN_LENGTH &&
    token.length <= INVITATION_TOKEN_MAX_LENGTH
  )
}

export function inviteAcceptView(input: {
  token: string
  previewValid: boolean | null
  previewFailed: boolean
}): "invalid" | "checking" | "form" {
  if (!inviteTokenIsWellFormed(input.token) || input.previewFailed) {
    return "invalid"
  }
  if (input.previewValid === null) return "checking"
  if (!input.previewValid) return "invalid"
  return "form"
}

export function invitationAcceptErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : ""
  if (SAFE_ACCEPT_ERRORS.has(message)) return message
  return invitationAcceptFallbackMessage
}
