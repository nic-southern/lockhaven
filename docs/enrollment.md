# Enrollment

1. Admin creates an enrollment token.
2. The device generates its WireGuard keypair locally.
3. The client submits metadata and its public key to `POST /api/enroll`.
4. The API allocates a VPN `/32`, creates the device row, issues a device
   check-in secret, and returns the client-side WireGuard settings.
5. The agent includes that secret on `POST /api/agent/check-in` so the API can
   accept status updates for the enrolled device.
6. The worker reconciles the server peer and status tables.

For Windows devices, the enrollment script can generate the keypair, call the
API over your app hostname, install WireGuard if needed, import the tunnel,
and start it.

## SOC Enrollment

Set `SOC_BASE_URL=https://soc.newmarketsecurity.com` and
`WAZUH_AGENT_ENROLLMENT_PASSWORD` in `.env.stage` before deploying. The Console
uses those values to generate the Windows SOC enrollment command for each site.

SOC enrollment uses:

- Manager host: `soc.newmarketsecurity.com`
- Agent event port: `1514/tcp`
- Enrollment port: `1515/tcp`
- Device role: `windows-endpoint`

Windows PowerShell:

```powershell
$BaseUrl = 'https://soc.newmarketsecurity.com'; $Script = "$env:TEMP\lockhaven-soc-enroll.ps1"; Invoke-WebRequest -Uri "$BaseUrl/install/enroll-windows.ps1" -OutFile $Script; powershell.exe -ExecutionPolicy Bypass -File $Script -BaseUrl $BaseUrl -SiteId "<SITE_NAME>" -DeviceRole "windows-endpoint" -EnrollmentPassword "<WAZUH_AGENT_ENROLLMENT_PASSWORD>"
```

Example for Milton Amvets:

```powershell
$BaseUrl = 'https://soc.newmarketsecurity.com'; $Script = "$env:TEMP\lockhaven-soc-enroll.ps1"; Invoke-WebRequest -Uri "$BaseUrl/install/enroll-windows.ps1" -OutFile $Script; powershell.exe -ExecutionPolicy Bypass -File $Script -BaseUrl $BaseUrl -SiteId "Milton Amvets" -DeviceRole "windows-endpoint" -EnrollmentPassword "<WAZUH_AGENT_ENROLLMENT_PASSWORD>"
```

Run the command as elevated PowerShell.
The SOC installer removes old Winlogbeat, keeps or updates Sysmon, installs the
Wazuh agent, and enrolls the host into groups such as `windows`,
`site-milton-amvets`, and `role-windows-endpoint`.
