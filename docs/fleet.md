# Agent fleet

The Console **Fleet** page shows agent versions across devices, publishes
releases, and queues allowed actions. Hub never sends a free-form script;
actions are only restart device, restart agent, or update agent.

## Releases and channels

Platform administrators publish rows in `agent_releases` (version, channel,
platform, download link, checksum). Organizations default to the **Stable**
channel. A site can follow the organization or choose **Beta**.

On check-in, Hub returns `desired_agent_version`, `download_url`, and
`sha256` for the resolved channel and the device's platform (Linux or Windows,
Intel/AMD or ARM). A shipped Hub image upserts those rows from checksum files
written next to the binaries at image build. The Go agent verifies the
checksum, replaces its own binary, and restarts its service. It will not
download from another host. Agents already in the field need one reinstall
before that command can run.

## Alerts

When a reporting device is older than the published release for its channel,
the worker opens a condition alert **Agent outdated**. The alert clears when
the device catches up or no matching release exists.

Two venue-severity condition alerts come from the same check-in data. Both
use the shared alert lifecycle (open, acknowledge, snooze, maintenance
windows, notifications, playbooks) and have organization or site thresholds
under **Settings → Alert policies**.

- **Disk full** reads the latest reported disks. A disk counts as full when it
  is at or above the used-percent threshold (default 95%) or has less than the
  free-space floor left (default 2 GB; set to 0 to use the percentage only).
  Temporary and read-only pseudo filesystems are ignored. This alert opens at
  any hour: a full drive stops a machine whether or not the location is open.
- **Agent not checking in** opens when the last accepted check-in is older
  than the threshold (default 15 minutes). It is a quiet kind like device
  offline: it is not opened while the location is closed, and the window is
  only counted from when the location opens, so a cabinet that powers up at
  open gets a full window before it is flagged.

Archived devices never raise either kind; archiving resolves any open ones.
Hub records the last accepted check-in separately from `last_seen_at`, which
also moves on tunnel contact and so cannot tell a dead agent from a live
cabinet.

## Commands

Operators with device update access can queue an action from Fleet. Hub stores
it in `device_commands` and includes `{ id, kind }` only. Unknown kinds are
refused.
