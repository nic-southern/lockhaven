import assert from "node:assert/strict"
import test from "node:test"

import { ticketingSetupStatus } from "./ticketing-destination"

test("tickets setup is configured when a matching webhook exists", () => {
  const previousUrl = process.env.TICKETING_INGEST_URL
  const previousSecret = process.env.TICKETING_INGEST_SECRET
  delete process.env.TICKETING_INGEST_URL
  delete process.env.TICKETING_INGEST_SECRET
  try {
    assert.deepEqual(ticketingSetupStatus(true), {
      ingestUrl: null,
      configured: true,
    })
    assert.deepEqual(ticketingSetupStatus(false), {
      ingestUrl: null,
      configured: false,
    })
  } finally {
    if (previousUrl === undefined) delete process.env.TICKETING_INGEST_URL
    else process.env.TICKETING_INGEST_URL = previousUrl
    if (previousSecret === undefined) delete process.env.TICKETING_INGEST_SECRET
    else process.env.TICKETING_INGEST_SECRET = previousSecret
  }
})

test("env URL plus secret can stand in for a webhook channel", () => {
  const previousUrl = process.env.TICKETING_INGEST_URL
  const previousSecret = process.env.TICKETING_INGEST_SECRET
  process.env.TICKETING_INGEST_URL = "https://pm.example.com/ingest/lockhaven"
  process.env.TICKETING_INGEST_SECRET = "host-secret-value"
  try {
    assert.deepEqual(ticketingSetupStatus(false), {
      ingestUrl: "https://pm.example.com/ingest/lockhaven",
      configured: true,
    })
  } finally {
    if (previousUrl === undefined) delete process.env.TICKETING_INGEST_URL
    else process.env.TICKETING_INGEST_URL = previousUrl
    if (previousSecret === undefined) delete process.env.TICKETING_INGEST_SECRET
    else process.env.TICKETING_INGEST_SECRET = previousSecret
  }
})
