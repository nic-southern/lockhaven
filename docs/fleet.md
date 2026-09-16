# Agent fleet

The Console **Fleet** page shows agent versions across devices, publishes
releases, and queues allowed actions. Hub never sends a free-form script;
actions are only restart device, restart agent, or update agent.

## Releases and channels

Platform administrators publish rows in `agent_releases` (version, channel,
platform, download link, checksum). Organizations default to the **Stable**
channel. A site can follow the organization or choose **Beta**.

On check-in, Hub returns `desired_agent_version` and `download_url` for the
resolved channel and platform, plus any waiting `commands`. The device
acknowledges those commands on the next check-in.

## Alerts

When a reporting device is older than the published release for its channel,
the worker opens a condition alert **Agent outdated**. The alert clears when
the device catches up or no matching release exists.

## Commands

Operators with device update access can queue an action from Fleet. Hub stores
it in `device_commands` and includes `{ id, kind }` only. Unknown kinds are
refused.
