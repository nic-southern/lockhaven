# Reports

The Console **Reports** page summarizes uptime, remote sessions, alerts, and
access for a chosen period and organization or site. Operators can download a
spreadsheet or email a report on a weekly or monthly schedule.

## Uptime

The worker `rollup-uptime` job rebuilds the last two UTC days from tunnel
samples into `device_uptime_daily`. Online time carries the last known state
across gaps. The current day is counted only up to now.

Daily rows older than 365 days are removed with history retention.

## Alert times

MTTA is the average time from first seen to acknowledge. MTTR is the average
time from first seen to resolve. Alerts without those timestamps are omitted
from the average.

## Scheduled email

Organization administrators can send a report to an existing email
notification channel. Delivery uses the same mail settings as invitations and
alerts (`MAIL_FROM` with Resend or SMTP). PDF layouts are not included.
