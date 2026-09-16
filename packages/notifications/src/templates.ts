import { alertKindLabels, type AlertKind } from "@nms/shared"

import { getProductName, inviteAcceptUrl } from "./product"
import type { AlertNotificationSnapshot } from "./payload"

export type RenderedMail = {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function wrapHtml(productName: string, title: string, body: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f4f4f5;font-family:ui-sans-serif,system-ui,sans-serif;color:#18181b;">
    <div style="max-width:560px;margin:32px auto;padding:32px;background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;">
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;">${escapeHtml(productName)}</p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${escapeHtml(title)}</h1>
      ${body}
    </div>
  </body>
</html>`
}

function alertKindLabel(kind: AlertKind) {
  return alertKindLabels[kind] ?? kind
}

function alertLines(alert: AlertNotificationSnapshot) {
  const kind = alertKindLabel(alert.kind)
  return {
    kind,
    title: alert.title,
    severity: alert.severity,
  }
}

export function renderInviteEmail(input: {
  name: string
  inviteUrl: string
  productName?: string
}): RenderedMail {
  const productName = input.productName ?? getProductName()
  const subject = `You're invited to ${productName}`
  const text = [
    `Hi ${input.name},`,
    "",
    `You've been invited to ${productName}. Open this link to create your password and finish setting up your account:`,
    input.inviteUrl,
    "",
    "This link works once and expires in 7 days. If you weren't expecting this, you can ignore it.",
  ].join("\n")
  const html = wrapHtml(
    productName,
    `You're invited`,
    `<p style="margin:0 0 16px;line-height:1.5;">Hi ${escapeHtml(input.name)},</p>
      <p style="margin:0 0 16px;line-height:1.5;">You've been invited to ${escapeHtml(productName)}. Use the button below to create your password and finish setting up your account.</p>
      <p style="margin:0 0 16px;"><a href="${escapeHtml(input.inviteUrl)}" style="display:inline-block;padding:10px 16px;background:#18181b;color:#fafafa;border-radius:8px;text-decoration:none;">Accept invitation</a></p>
      <p style="margin:0;font-size:13px;color:#71717a;line-height:1.5;">This link works once and expires in 7 days. If you weren't expecting this, you can ignore it.</p>`
  )
  return { subject, text, html }
}

export function renderPasswordResetEmail(input: {
  resetUrl: string
  productName?: string
}): RenderedMail {
  const productName = input.productName ?? getProductName()
  const subject = `Reset your ${productName} password`
  const text = [
    `We received a request to reset your ${productName} password.`,
    "",
    "Open this link to choose a new password:",
    input.resetUrl,
    "",
    "If you didn't ask for this, you can ignore this message. Your password will stay the same.",
  ].join("\n")
  const html = wrapHtml(
    productName,
    "Reset your password",
    `<p style="margin:0 0 16px;line-height:1.5;">We received a request to reset your ${escapeHtml(productName)} password.</p>
      <p style="margin:0 0 16px;"><a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;padding:10px 16px;background:#18181b;color:#fafafa;border-radius:8px;text-decoration:none;">Choose a new password</a></p>
      <p style="margin:0;font-size:13px;color:#71717a;line-height:1.5;">If you didn't ask for this, you can ignore this message. Your password will stay the same.</p>`
  )
  return { subject, text, html }
}

export function renderAlertOpenedEmail(input: {
  alert: AlertNotificationSnapshot
  productName?: string
}): RenderedMail {
  const productName = input.productName ?? getProductName()
  const { kind, title, severity } = alertLines(input.alert)
  const subject = `${productName} alert: ${title}`
  const text = [
    `A new alert is open in ${productName}.`,
    "",
    `Title: ${title}`,
    `Kind: ${kind}`,
    `Severity: ${severity}`,
  ].join("\n")
  const html = wrapHtml(
    productName,
    "A new alert is open",
    `<p style="margin:0 0 16px;line-height:1.5;">${escapeHtml(title)}</p>
      <p style="margin:0;font-size:13px;color:#71717a;line-height:1.5;">${escapeHtml(kind)} · ${escapeHtml(severity)}</p>`
  )
  return { subject, text, html }
}

export function renderAlertResolvedEmail(input: {
  alert: AlertNotificationSnapshot
  productName?: string
}): RenderedMail {
  const productName = input.productName ?? getProductName()
  const { kind, title, severity } = alertLines(input.alert)
  const subject = `${productName} alert resolved: ${title}`
  const text = [
    `An alert in ${productName} is now resolved.`,
    "",
    `Title: ${title}`,
    `Kind: ${kind}`,
    `Severity: ${severity}`,
  ].join("\n")
  const html = wrapHtml(
    productName,
    "An alert is resolved",
    `<p style="margin:0 0 16px;line-height:1.5;">${escapeHtml(title)}</p>
      <p style="margin:0;font-size:13px;color:#71717a;line-height:1.5;">${escapeHtml(kind)} · ${escapeHtml(severity)}</p>`
  )
  return { subject, text, html }
}

export function renderAlertEscalatedEmail(input: {
  alert: AlertNotificationSnapshot
  productName?: string
}): RenderedMail {
  const productName = input.productName ?? getProductName()
  const { kind, title, severity } = alertLines(input.alert)
  const subject = `${productName} alert needs attention: ${title}`
  const text = [
    `An open alert in ${productName} has been escalated.`,
    "",
    `Title: ${title}`,
    `Kind: ${kind}`,
    `Severity: ${severity}`,
  ].join("\n")
  const html = wrapHtml(
    productName,
    "An alert needs attention",
    `<p style="margin:0 0 16px;line-height:1.5;">${escapeHtml(title)} has been open long enough to escalate.</p>
      <p style="margin:0;font-size:13px;color:#71717a;line-height:1.5;">${escapeHtml(kind)} · ${escapeHtml(severity)}</p>`
  )
  return { subject, text, html }
}

export function renderChannelTestEmail(input: {
  channelName: string
  productName?: string
}): RenderedMail {
  const productName = input.productName ?? getProductName()
  const subject = `${productName} test message`
  const text = `This is a test message from ${productName} for the "${input.channelName}" channel. If you received it, this destination is working.`
  const html = wrapHtml(
    productName,
    "Test message",
    `<p style="margin:0;line-height:1.5;">This is a test message from ${escapeHtml(productName)} for the &ldquo;${escapeHtml(input.channelName)}&rdquo; channel. If you received it, this destination is working.</p>`
  )
  return { subject, text, html }
}

export function renderAccessRequestedEmail(input: {
  deviceName: string
  siteName: string
  requesterName: string
  reason: string | null
  approvalsUrl: string
  productName?: string
}): RenderedMail {
  const productName = input.productName ?? getProductName()
  const subject = `${productName}: access request for ${input.deviceName}`
  const reasonLine = input.reason
    ? `Reason: ${input.reason}`
    : "No reason was given."
  const text = [
    `${input.requesterName} asked to start a session on ${input.deviceName} (${input.siteName}).`,
    "",
    reasonLine,
    "",
    "Review the request:",
    input.approvalsUrl,
  ].join("\n")
  const html = wrapHtml(
    productName,
    "Access needs review",
    `<p style="margin:0 0 16px;line-height:1.5;">${escapeHtml(input.requesterName)} asked to start a session on ${escapeHtml(input.deviceName)} (${escapeHtml(input.siteName)}).</p>
      ${input.reason ? `<p style="margin:0 0 16px;line-height:1.5;">${escapeHtml(input.reason)}</p>` : `<p style="margin:0 0 16px;line-height:1.5;color:#71717a;">No reason was given.</p>`}
      <p style="margin:0;"><a href="${escapeHtml(input.approvalsUrl)}" style="display:inline-block;padding:10px 16px;background:#18181b;color:#fafafa;border-radius:8px;text-decoration:none;">Review request</a></p>`
  )
  return { subject, text, html }
}

export function inviteMailFromToken(input: {
  name: string
  token: string
  baseUrl: string
  productName?: string
}) {
  return renderInviteEmail({
    name: input.name,
    inviteUrl: inviteAcceptUrl(input.baseUrl, input.token),
    productName: input.productName,
  })
}
