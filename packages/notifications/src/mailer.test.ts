import assert from "node:assert/strict"
import test from "node:test"

import {
  MemoryMailer,
  sendTransactionalMail,
  setMailerForTests,
} from "./mailer"

test("transactional mail keeps CSV attachments", async () => {
  const mailer = new MemoryMailer()
  setMailerForTests(mailer)
  const csv = "Device,Uptime\r\nFront desk,99.2%\r\n"
  const sent = await sendTransactionalMail(
    {
      to: "ops@example.com",
      subject: "Weekly uptime",
      text: "Attached.",
      html: "<p>Attached.</p>",
      attachments: [
        {
          filename: "uptime.csv",
          content: csv,
          contentType: "text/csv;charset=utf-8",
        },
      ],
    },
    { MAIL_FROM: "Lockhaven <noreply@example.com>", SMTP_URL: "smtp://example" }
  )

  assert.equal(sent, true)
  assert.equal(mailer.sent.length, 1)
  assert.equal(mailer.sent[0]?.attachments?.[0]?.filename, "uptime.csv")
  assert.equal(mailer.sent[0]?.attachments?.[0]?.content, csv)
  setMailerForTests(undefined)
})
