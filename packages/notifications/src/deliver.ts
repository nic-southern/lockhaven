import { getMailer, isMailConfigured, type Mailer } from "./mailer"
import {
  buildWebhookEnvelope,
  serializeWebhookBody,
  type AlertNotificationSnapshot,
  type AccessRequestNotificationSnapshot,
  type PlaybookRunNotificationSnapshot,
  type NotificationDeliveryEvent,
} from "./payload"
import { getProductName } from "./product"
import { webhookHeaders } from "./signature"
import {
  renderAccessRequestedEmail,
  renderAlertEscalatedEmail,
  renderAlertOpenedEmail,
  renderAlertResolvedEmail,
  renderChannelTestEmail,
  renderPlaybookRequestedEmail,
} from "./templates"

export type EmailDestination = {
  type: "email"
  addresses: string[]
  channelName: string
}

export type WebhookDestination = {
  type: "webhook"
  url: string
  secret: string
}

export type NotificationDestination = EmailDestination | WebhookDestination

export async function deliverNotification(input: {
  destination: NotificationDestination
  event: NotificationDeliveryEvent
  alert?: AlertNotificationSnapshot | null
  accessRequest?: AccessRequestNotificationSnapshot | null
  playbookRun?: PlaybookRunNotificationSnapshot | null
  mailer?: Mailer
  from?: string
  now?: Date
}): Promise<string> {
  const { destination, event } = input
  if (destination.type === "email") {
    return deliverEmail({
      destination,
      event,
      alert: input.alert ?? null,
      accessRequest: input.accessRequest ?? null,
      playbookRun: input.playbookRun ?? null,
      mailer: input.mailer,
      from: input.from,
    })
  }
  return deliverWebhook({
    destination,
    event,
    alert: input.alert ?? null,
    accessRequest: input.accessRequest ?? null,
    playbookRun: input.playbookRun ?? null,
    now: input.now,
  })
}

function mailForEvent(
  event: NotificationDeliveryEvent,
  alert: AlertNotificationSnapshot | null,
  accessRequest: AccessRequestNotificationSnapshot | null,
  playbookRun: PlaybookRunNotificationSnapshot | null,
  channelName: string
) {
  const productName = getProductName()
  if (event === "channel.test") {
    return renderChannelTestEmail({ channelName, productName })
  }
  if (event === "access.requested") {
    if (!accessRequest) {
      throw new Error("Access request snapshot missing for this delivery")
    }
    const baseUrl =
      process.env.APP_BASE_URL ??
      process.env.BETTER_AUTH_URL ??
      "http://localhost:3000"
    return renderAccessRequestedEmail({
      deviceName: accessRequest.deviceName,
      siteName: accessRequest.siteName,
      requesterName:
        accessRequest.requesterName || accessRequest.requesterEmail,
      reason: accessRequest.reason,
      approvalsUrl: new URL("/approvals", baseUrl).toString(),
      productName,
    })
  }
  if (event === "playbook.requested") {
    if (!playbookRun) {
      throw new Error("Playbook snapshot missing for this delivery")
    }
    const baseUrl =
      process.env.APP_BASE_URL ??
      process.env.BETTER_AUTH_URL ??
      "http://localhost:3000"
    return renderPlaybookRequestedEmail({
      playbookName: playbookRun.playbookName,
      deviceName: playbookRun.deviceName,
      actionLabel: playbookRun.action,
      approvalsUrl: new URL("/approvals", baseUrl).toString(),
      productName,
    })
  }
  if (!alert) {
    throw new Error("Alert snapshot missing for this delivery")
  }
  if (event === "alert.resolved") {
    return renderAlertResolvedEmail({ alert, productName })
  }
  if (event === "alert.escalated") {
    return renderAlertEscalatedEmail({ alert, productName })
  }
  return renderAlertOpenedEmail({ alert, productName })
}

async function deliverEmail(input: {
  destination: EmailDestination
  event: NotificationDeliveryEvent
  alert: AlertNotificationSnapshot | null
  accessRequest: AccessRequestNotificationSnapshot | null
  playbookRun: PlaybookRunNotificationSnapshot | null
  mailer?: Mailer
  from?: string
}) {
  const from = input.from ?? process.env.MAIL_FROM
  if (!from || !isMailConfigured()) {
    throw new Error("Mail is not configured")
  }
  const rendered = mailForEvent(
    input.event,
    input.alert,
    input.accessRequest,
    input.playbookRun,
    input.destination.channelName
  )
  const mailer = input.mailer ?? getMailer()
  await mailer.send({
    from,
    to: input.destination.addresses,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  })
  return `accepted ${input.destination.addresses.length} recipient(s)`
}

async function deliverWebhook(input: {
  destination: WebhookDestination
  event: NotificationDeliveryEvent
  alert: AlertNotificationSnapshot | null
  accessRequest: AccessRequestNotificationSnapshot | null
  playbookRun: PlaybookRunNotificationSnapshot | null
  now?: Date
}) {
  const body = serializeWebhookBody(
    buildWebhookEnvelope({
      event: input.event,
      alert: input.alert,
      accessRequest: input.accessRequest,
      playbookRun: input.playbookRun,
      occurredAt: input.now,
    })
  )
  const signed = webhookHeaders(input.destination.secret, body, input.now)
  const response = await fetch(input.destination.url, {
    method: "POST",
    headers: signed.headers,
    body,
    signal: AbortSignal.timeout(15_000),
  })
  const preview = await response.text().then((text) => text.slice(0, 500))
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}${preview ? `: ${preview}` : ""}`)
  }
  return `HTTP ${response.status}`
}
