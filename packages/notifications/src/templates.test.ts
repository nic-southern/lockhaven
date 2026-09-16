import assert from "node:assert/strict"
import test from "node:test"

import { inviteAcceptUrl } from "./product"
import {
  inviteMailFromToken,
  renderAccessRequestedEmail,
  renderAlertEscalatedEmail,
  renderAlertOpenedEmail,
  renderAlertResolvedEmail,
  renderInviteEmail,
  renderPasswordResetEmail,
  renderScheduledReportEmail,
} from "./templates"
import type { AlertNotificationSnapshot } from "./payload"

const alert: AlertNotificationSnapshot = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "device_offline",
  severity: "warning",
  title: "Office NAS has been offline for more than 24 hours",
  status: "open",
  organizationId: "22222222-2222-4222-8222-222222222222",
  siteId: "33333333-3333-4333-8333-333333333333",
  deviceId: "44444444-4444-4444-8444-444444444444",
  detail: { device: "Office NAS" },
}

test("renders an invite with the accept link and recipient name", () => {
  const token = "invite-token-value"
  const baseUrl = "https://console.example.com"
  const mail = inviteMailFromToken({
    name: "Alex Rivera",
    token,
    baseUrl,
    productName: "Lockhaven",
  })
  const expectedUrl = inviteAcceptUrl(baseUrl, token)

  assert.equal(mail.subject, "You're invited to Lockhaven")
  assert.match(mail.text, /Alex Rivera/)
  assert.match(mail.text, /Lockhaven/)
  assert.equal(mail.text.includes(expectedUrl), true)
  assert.equal(mail.html.includes(expectedUrl), true)
  assert.equal(mail.text.includes("JSON"), false)
  assert.equal(mail.text.includes("Resend"), false)
  assert.equal(mail.html.includes("Resend"), false)
})

test("invite helper matches the standalone invite template", () => {
  const inviteUrl = "https://console.example.com/accept-invite?token=abc"
  const mail = renderInviteEmail({
    name: "Sam",
    inviteUrl,
    productName: "Lockhaven",
  })
  assert.match(mail.html, /Accept invitation/)
  assert.match(mail.text, /expires in 7 days/)
})

test("renders password reset, opened, resolved, and escalation mail", () => {
  const reset = renderPasswordResetEmail({
    resetUrl: "https://console.example.com/reset-password?token=reset-token",
    productName: "Lockhaven",
  })
  assert.match(reset.subject, /Reset your Lockhaven password/)
  assert.match(reset.text, /reset-token/)

  const opened = renderAlertOpenedEmail({ alert, productName: "Lockhaven" })
  assert.match(opened.subject, /Office NAS/)
  assert.match(opened.text, /Device offline/)

  const resolved = renderAlertResolvedEmail({
    alert: { ...alert, status: "resolved" },
    productName: "Lockhaven",
  })
  assert.match(resolved.subject, /resolved/)
  assert.match(resolved.text, /now resolved/)

  const escalated = renderAlertEscalatedEmail({
    alert,
    productName: "Lockhaven",
  })
  assert.match(escalated.subject, /needs attention/)
  assert.match(escalated.text, /escalated/)
})

test("renders an access request for reviewers", () => {
  const mail = renderAccessRequestedEmail({
    deviceName: "Front desk PC",
    siteName: "Downtown",
    requesterName: "Alex Rivera",
    reason: "Replace a failed disk",
    approvalsUrl: "https://console.example.com/approvals",
    productName: "Lockhaven",
  })
  assert.match(mail.subject, /Front desk PC/)
  assert.match(mail.text, /Alex Rivera/)
  assert.match(mail.text, /Replace a failed disk/)
  assert.match(mail.text, /https:\/\/console.example.com\/approvals/)
  assert.equal(mail.text.includes("JSON"), false)
  assert.equal(mail.text.includes("Guacamole"), false) // pragma: allowlist secret
})

test("renders a scheduled report with the period and attachment name", () => {
  const mail = renderScheduledReportEmail({
    reportLabel: "Uptime",
    cadenceLabel: "Weekly",
    rangeLabel: "2026-09-07 to 2026-09-13",
    organizationName: "Northwind",
    attachmentName: "uptime-2026-09-07-2026-09-13.csv",
    productName: "Lockhaven",
  })
  assert.match(mail.subject, /weekly uptime/i)
  assert.match(mail.text, /Northwind/)
  assert.match(mail.text, /2026-09-07 to 2026-09-13/)
  assert.match(mail.html, /Uptime is ready/)
  assert.equal(mail.text.includes("JSON"), false)
  assert.equal(mail.text.includes("Postgres"), false)
})
