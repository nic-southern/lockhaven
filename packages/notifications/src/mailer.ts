import { Resend } from "resend"
import nodemailer from "nodemailer"

export type MailAddress = string | string[]

export type MailMessage = {
  from: string
  to: MailAddress
  subject: string
  text: string
  html: string
}

export interface Mailer {
  send(message: MailMessage): Promise<void>
}

export class ResendMailer implements Mailer {
  private readonly client: Resend

  constructor(apiKey: string) {
    this.client = new Resend(apiKey)
  }

  async send(message: MailMessage) {
    const { error } = await this.client.emails.send({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
    if (error) {
      throw new Error(error.message)
    }
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport: nodemailer.Transporter

  constructor(smtpUrl: string) {
    this.transport = nodemailer.createTransport(smtpUrl)
  }

  async send(message: MailMessage) {
    await this.transport.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })
  }
}

/** Records messages without delivering them. Used when mail is not configured. */
export class LoggingMailer implements Mailer {
  readonly sent: MailMessage[] = []

  async send(message: MailMessage) {
    this.sent.push(message)
    console.info("mail not delivered; no mail provider is configured", {
      to: message.to,
      subject: message.subject,
    })
  }
}

export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = []

  async send(message: MailMessage) {
    this.sent.push(message)
  }
}

export function isMailProviderConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.RESEND_API_KEY || env.SMTP_URL)
}

export function isMailConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.MAIL_FROM) && isMailProviderConfigured(env)
}

export function createMailerFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Mailer {
  if (env.RESEND_API_KEY) {
    return new ResendMailer(env.RESEND_API_KEY)
  }
  if (env.SMTP_URL) {
    return new SmtpMailer(env.SMTP_URL)
  }
  return new LoggingMailer()
}

let sharedMailer: Mailer | undefined

export function getMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  sharedMailer ??= createMailerFromEnv(env)
  return sharedMailer
}

/** Test helper to replace the process-wide mailer. */
export function setMailerForTests(mailer: Mailer | undefined) {
  sharedMailer = mailer
}

export async function sendTransactionalMail(
  message: Omit<MailMessage, "from"> & { from?: string },
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const from = message.from ?? env.MAIL_FROM
  if (!from) {
    console.warn("MAIL_FROM is not set; skipping mail")
    return false
  }
  if (!isMailProviderConfigured(env)) {
    console.warn("No mail provider is configured; skipping mail")
    return false
  }
  await getMailer(env).send({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  })
  return true
}
