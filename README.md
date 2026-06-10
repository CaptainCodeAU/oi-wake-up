# oi-wake-up

Wake-on-LAN done right. No dependencies, just Node.js.

## Install

```bash
git clone https://github.com/CaptainCodeAU/oi-wake-up.git
cd oi-wake-up
pnpm install -g .
```

Because this project has zero runtime dependencies, global install is risk-free — no version conflicts, no transitive surface, nothing to audit. npm is not supported for this project.

## CLI Usage

```
Usage: oi-wake-up [options] <mac> [mac...]

Arguments:
  mac                    MAC address(es) to wake

Options:
  -i, --address <ip>     Destination IP (default: "255.255.255.255")
  -p, --port <number>    Destination port (default: 9)
  -q, --quiet            Suppress output
  -f, --file <path>      Read MAC addresses from file
  -d, --delay <ms>       Delay between packets in ms (default: 0)
  --print-packet         Print 102-byte hex dump; do not send
  -v, --version          Show version
  -h, --help             Show help
```

### Examples

```bash
# Wake a single machine
oi-wake-up AA:BB:CC:DD:EE:FF

# Wake on a specific subnet
oi-wake-up -i 192.168.1.255 AA:BB:CC:DD:EE:FF

# Wake multiple machines with a delay
oi-wake-up -d 100 AA:BB:CC:DD:EE:FF 11:22:33:44:55:66

# Wake machines from a file
oi-wake-up -f machines.wol
```

## Wake + Verify (`oi-wake-verify`)

A second binary in this repo. Wakes a host **only if it's actually asleep**, waits for SSH, runs a remediation command, and optionally verifies. The motivating case: Windows sleep/wake on the RTX 3090 box drops the docker container's GPU passthrough, and this collapses *wake → ssh → `just restart`* into one idempotent command. By default, running it on an already-awake host does nothing.

### Quick start

```bash
# Wake (if asleep), wait for SSH, restart docker, verify the GPU path.
oi-wake-verify mymachine \
    --mac AA:BB:CC:DD:EE:FF \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'"

# Just send the magic packet (don't wait, don't remediate).
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF --wake-only

# Already awake? Force the remediation anyway.
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF --force \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'"

# Show what would happen without doing anything.
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF --dry-run -v
```

**On `--grace`**: applies twice on the wake-and-remediate path — once after SSH comes up (services may not be ready yet), once after `--remediate` runs (just-restarted services may not be ready yet). The default `10` is reasonable when your `--verify` command handles its own readiness wait (e.g. polls until the API can actually serve a request). Bump it if your verify is naive about timing — the cost of being wrong is a `verify failed` exit 5 on a healthy host.

**On wrapping commands in `bash -lc '…'`**: SSH non-interactive command execution uses the target's login shell. If that shell is zsh and your binaries (`just`, project scripts, etc.) are on PATH only via bash's profile, the command will fail with `command not found`. Wrapping the remediate and verify in `bash -lc '…'` forces a bash login shell with full PATH initialisation. Safe even when the target's default shell is bash.

**On `--journal <path>`**: appends a JSON record (one line, JSONL) to `<path>` on every run. Useful for cron wrappers, Home Assistant automations, or any consumer that wants a persistent audit trail.

**On `--retry-wake <n>`**: if SSH never comes up within `--timeout`, re-sends the magic packet and re-polls up to `n` additional times before giving up. Useful when the first packet hits the network during MAC-table churn.

**On `--max-output <bytes>`**: caps the stdout + stderr captured from `--remediate` and `--verify` commands (default: 1 MiB). Chatty commands get truncated at the limit with a `[output truncated]` marker; they don't balloon memory or flood the journal.

**On `--remediate-timeout <s>` / `--verify-timeout <s>`**: cap how long a `--remediate` or `--verify` command may run before it's killed (`SIGKILL`) and the run fails cleanly with exit 4 / 5 (`… timed out after Ns`). Default `0` = no cap (unchanged behaviour). Set these when a command can genuinely hang — e.g. a remote restart that holds the SSH channel open. Pick a value above the command's legitimate worst case (a cold model load, a slow restart): the cost of being wrong is a spurious exit 4/5 on a healthy host.

**On the SSH command channel**: the `--remediate` and `--verify` connections always carry `ConnectTimeout=10` plus `ServerAliveInterval=5`/`ServerAliveCountMax=3`. This bounds a stalled TCP connect to ~10s (instead of OpenSSH's ~120s default) and detects a silently-dropped channel in ~15s — the failure mode that bites in the fragile window right after a WoL wake, when the target's network stack may not be fully up. A fast failure lets a calling wrapper buffer and retry on its next cycle rather than blocking. (The probe and `oi-wake-down`'s sleep channel are deliberately left as-is.)

**On `--capture-wake-source`** (Windows/WSL): after a wake-and-up run, this runs the read-only `powercfg /lastwake` over the existing SSH channel and attaches a top-level `wakeSource` object to the `--json`/`--journal` record — the Windows wake-source attribution that answers *"did our magic packet wake the box, or did a NIC / HID / wake timer?"*. It is **read-only** (never changes power policy) and **never fatal** (a capture failure on a non-Windows target, a missing `powercfg`, or a dropped channel is recorded as `{captured:false, ...}` without changing the exit code). Capture only runs when a wake was actually performed and SSH came up — it fires before remediation restarts anything, so `/lastwake` still reflects this run's wake. On an already-awake host it records `{performedWake:false, captured:false, reason:"..."}` rather than a stale prior wake, so a consumer can key off the `captured` boolean to tell "no wake this run" apart from "captured: external device". Caveat: `/lastwake` reports only the most recent wake, so it can misattribute if something else woke the box between the packet and the SSH connect; the verbatim `raw` text is retained for sanity-checking.

**On `--capture-verify`**: includes the `--remediate`/`--verify` command `stdout`+`stderr` in their `steps[]` records regardless of verbosity (bounded by `--max-output`), so automation can extract proof artifacts (e.g. `cold_ms=N hot_ms=N threshold_ms=N`) without scraping `-d` output: `… --capture-verify --json | jq -r '.steps[]|select(.kind=="verify")|.stdout'`.

**On `--status`**: a probe-only liveness mode — probe SSH, report `reachable`/`unreachable`, and exit 0 either way (no wake, no remediation, and no exit 3 on an unreachable host). `--mac` is not required. For monitoring scripts and Home Assistant sensors.

**On `-F` / `--ssh-config <path>`**: forwards an explicit ssh config to `ssh -F <path>` for contexts where `~/.ssh/config` is unreadable (systemd `ProtectHome=true`, cron, containers). Applies to the probe, remediate, verify, and wake-source channels.

**On timestamps**: every `--json`/`--journal` record (on both `oi-wake-verify` and `oi-wake-down`) carries `ts` (run-start, ISO-8601 UTC) and `finishedAt` (run-end), present on all exit paths including a signal-kill flush — so a consumer can order and correlate runs against external logs.

Run `oi-wake-verify --help` for the full flag reference.

### A note on what `--verify` should actually exercise

Pick a verify command that exercises the **failing layer**, not an adjacent one. The motivating case here — Windows sleep/wake silently breaks the docker container's GPU passthrough — is a useful illustration of how easy it is to verify the wrong thing:

- `docker exec <container> nvidia-smi` looks like it tests the GPU, but it doesn't. `nvidia-smi` exits 0 even when the container has lost CUDA access (the `"GPU access blocked"` text goes to stdout, not the exit code). The verify can pass while inference is silently running on CPU at 5–30× the latency.
- A timed inference call — even a 5-token completion against the smallest loaded model — does test the layer that actually matters. If GPU is healthy you get sub-second latency; on CPU fallback you get seconds.

The example above delegates that decision to a `just warmup` recipe on the target host, which keeps the threshold logic colocated with the models and runtime it depends on. The general principle: your verify should fail when a real workload would.

On the remediation side: `just restart` rebinds the GPU on this setup; if an in-place restart ever fails to restore GPU access, a full recreate — `docker compose up -d --force-recreate` — re-runs the container's device injection and is the fallback. That recovery recipe, like the verify recipe, is owned by the target's own project repo, not by `oi-wake-verify` — the tool just runs whatever `--remediate` command you give it.

If you want **positive direct evidence** on top of latency gating (e.g. "I want to see the GPU light up during the probe call"), the verify recipe can sample `nvidia-smi` in parallel with the inference call and gate on utilisation. The 3090 reference setup ships both flavours: `just warmup` (routine, latency-only, ~5s) and `just gpu-probe` (diagnostic, latency + GPU-Util sampling, ~5–10s). The recipes share the same `key=value` parseable-line output discipline; either is a drop-in for `--verify`.

### Exit codes (stable contract)

| Code | Meaning |
| ---: | --- |
| 0    | Success or already-awake (no action needed) |
| 1    | Misconfiguration |
| 2    | WoL send failed |
| 3    | SSH timeout (machine never came up within `--timeout`) |
| 4    | Remediation command failed |
| 5    | Verification failed |
| 64   | Invalid CLI usage (unknown flag, conflicting mode flags) |
| 130  | Interrupted (SIGINT / SIGTERM / SIGHUP) |

These are stable — branch on them from cron, Home Assistant, shell wrappers. On any of these signals the `--json` object and `--journal` line are still flushed before exit, so a parent that times the process out (e.g. an `execFile` timeout sending `SIGTERM`) still gets a record naming the step that was in flight.

### Recommended setup: lean on `~/.ssh/config`

Define the SSH connection details once in `~/.ssh/config`, then the shell alias only carries the wake/remediate bits:

```sshconfig
# ~/.ssh/config
Host mymachine
    HostName        192.168.1.10
    User            youruser
    Port            2522                 # WSL-side sshd, NOT Windows-OpenSSH
    IdentityFile    ~/.ssh/mymachine
    IdentitiesOnly  yes
```

```bash
# ~/.zshrc (or ~/.bashrc)
alias wakeup='oi-wake-verify mymachine \
    --mac AA:BB:CC:DD:EE:FF \
    --broadcast 192.168.1.255 \
    --remediate "bash -lc \"cd ~/repos/myproject && just restart\"" \
    --verify   "bash -lc \"cd /home/youruser/repos/myproject && just warmup\"" \
    --remediate-timeout 60 --verify-timeout 90'

alias wakedown='oi-wake-down mymachine'
```

**Why port 2522?** SSHing directly to the WSL Ubuntu sshd lands the remediation in `bash`, with normal POSIX quoting and key auth. SSHing to Windows OpenSSH on port 22 lands in PowerShell, which (a) parses commands with PowerShell rules instead of bash, (b) breaks `ssh-copy-id`, and (c) requires `wsl.exe -d Ubuntu --` shimming and the `C:\ProgramData\ssh\administrators_authorized_keys` quirk for Admin accounts. Use the WSL-direct path when you can. The Windows-OpenSSH path works as a fallback — just expect to rewrite the `--remediate` string in PowerShell-friendly form.

### Install

This binary ships in the same package as `oi-wake-up`. Once installed (see [Install](#install) above), `oi-wake-up`, `oi-wake-verify`, and `oi-wake-down` are all on your `PATH`.

## Remote Sleep (`oi-wake-down`)

A third binary that completes the wake/sleep symmetry. SSHes into the host, sends a sleep command, and polls until the host becomes unreachable. Idempotent — if the host is already unreachable, exits 0 with no action.

### Quick start

```bash
# Put the machine to sleep and confirm it went unreachable.
oi-wake-down mymachine

# Fire-and-forget — send the sleep command without waiting.
oi-wake-down mymachine --no-confirm

# Show what would happen without doing anything.
oi-wake-down mymachine --dry-run -v
```

**Default sleep command (Windows via WSL):** `/mnt/c/Windows/System32/rundll32.exe powrprof.dll,SetSuspendState 0,1,0`. Override with `--command` for other platforms:

```bash
oi-wake-down mylinuxbox --command 'sudo systemctl suspend'
oi-wake-down mymac      --command 'pmset sleepnow'
```

**Gotcha — hibernate vs. sleep:** if Windows hibernation is enabled, `SetSuspendState` silently hibernates instead of sleeping. One-time fix on the Windows side:

```powershell
powercfg /h off
```

See [docs/GLOSSARY.md](docs/GLOSSARY.md) for the S3 vs. S4 distinction.

**Connection-drop handling:** when the host sleeps before `rundll32` returns, SSH reports exit 255 with a "connection closed" or "broken pipe" message. `oi-wake-down` treats this as successful delivery and continues to the confirm-asleep poll — it is not treated as a failure.

**On `-F` / `--ssh-config <path>`** (v1.5.0): like `oi-wake-verify`, `oi-wake-down` accepts an explicit ssh config (`ssh -F <path>`) for `ProtectHome`/cron/container contexts where `~/.ssh/config` is unreadable — useful when one caller drives both the wake and sleep sides. Every `--json`/`--journal` record also carries the same `ts` + `finishedAt` timestamps as `oi-wake-verify`.

Run `oi-wake-down --help` for the full flag reference.

### Exit codes (stable contract)

| Code | Meaning |
| ---: | --- |
| 0    | Success or already asleep (no action needed) |
| 1    | Misconfiguration |
| 6    | Sleep command failed (non-connection-drop error) |
| 7    | Sleep not confirmed — host still reachable after `--timeout` seconds |
| 64   | Invalid CLI usage |
| 130  | Interrupted (SIGINT / SIGTERM / SIGHUP) |

On any of these signals the `--json` object and `--journal` line are flushed before exit (parity with `oi-wake-verify`).

### Install

Same package as `oi-wake-up` — `oi-wake-down` is available once installed (see [Install](#install) above).

---

## Library Usage

```javascript
import { wake, wakeMany, createMagicPacket, parseMAC, isValidMAC } from 'oi-wake-up';

// Send a magic packet (defaults: broadcast 255.255.255.255, port 9)
await wake('AA:BB:CC:DD:EE:FF');

// With options
await wake('AA:BB:CC:DD:EE:FF', {
  address: '192.168.1.255',
  port: 7,
});

// Wake multiple targets over a single socket, with an optional inter-packet delay
await wakeMany(
  [
    { mac: 'AA:BB:CC:DD:EE:FF' },
    { mac: '11:22:33:44:55:66', address: '192.168.1.255' },
  ],
  { delay: 100 },   // ms between packets
);

// Build a packet manually
const packet = createMagicPacket('AA:BB:CC:DD:EE:FF'); // 102-byte Buffer

// Validate a MAC address
isValidMAC('AA:BB:CC:DD:EE:FF'); // true
isValidMAC('not-a-mac');         // false

// Parse a MAC address
const buf = parseMAC('AA:BB:CC:DD:EE:FF'); // 6-byte Buffer
```

The verify orchestrator is also importable for programmatic use:

```javascript
import { parseVerifyArgs, decideAction, executePlan, createLogger, EXIT } from 'oi-wake-up/verify';

const opts = parseVerifyArgs(['myhost', '--mac', 'AA:BB:CC:DD:EE:FF']);
const plan = decideAction('unreachable', opts);
const log = createLogger('default', false);
const ctrl = new AbortController();
const journal = { host: opts.host, state: 'unreachable', steps: [], exit: EXIT.OK, durationMs: 0 };
const total = plan.length + 1;

await executePlan(plan, opts, { log, journal, total, ctrl });
// journal.exit is one of the EXIT values
```

## Supported MAC Formats

| Format    | Example             |
| --------- | ------------------- |
| Canonical | `01:02:03:04:05:06` |
| Windows   | `01-02-03-04-05-06` |
| Bare      | `010203040506`      |

## File Format (-f)

```
# Comments start with #
# Blank lines are ignored
# Format: MAC [IP] [PORT]

01:02:03:04:05:06
01:02:03:04:05:07 192.168.1.255
01:02:03:04:05:08 192.168.1.255 7
```

## Prerequisites — Preparing the Target PC

Before using Wake-on-LAN, the target machine must be properly configured. This section covers BIOS settings, OS-level configuration, and common pitfalls.

### 1. BIOS / UEFI Settings

Enter your BIOS (typically `DEL`, `F2`, or `F12` during boot) and enable these settings. The exact names vary by motherboard manufacturer:

| Setting | Common Names | Required |
| ------- | ------------ | -------- |
| Wake-on-LAN | "Wake on LAN", "Power On By PCI-E", "Wake on PME", "Resume By PCI-E Device", "PCIe Wake Up" | **Enabled** |
| Restore on AC Power Loss | "Restore on AC Power Loss", "AC Power Loss", "After Power Failure" | **Power On** |
| ErP / EuP Ready | "ErP Ready", "EuP 2013", "Energy Efficient Ethernet" | **Disabled** |
| Deep Sleep | "Deep Sleep Control", "S4-S5 Deep Sleep", "Ultra Deep Sleep" | **Disabled** |
| Network Stack | "PXE Boot", "Network Boot" | Sometimes needed |

> **Important:** These settings vary significantly by motherboard manufacturer:
> - **ASUS:** Look under Advanced → APM Configuration → "Power On By PCI-E"
> - **MSI:** Look under Settings → Wake Up Event Setup → "Resume By PCI-E Device"
> - **Gigabyte:** Look under Settings → Platform Power → "Wake on LAN" and "ErP"
> - **ASRock:** Look under Advanced → ACPI Configuration → "PCI-E Wake Up"
>
> **ErP Ready is a common hidden blocker.** When enabled, it cuts all standby power to meet EU energy regulations — including power to the NIC. WoL requires the NIC to maintain standby power, so ErP must be **Disabled**.
>
> **"Restore on AC Power Loss" can be critical.** On some motherboards (notably MSI X570), setting this to **"Power On"** is required for WoL to function — even though the setting's name suggests it only controls behavior after a power outage. When set to "Power Off", the board may not supply standby power to the NIC correctly in S5 (shutdown) state. If everything else looks correct and WoL still doesn't work, try changing this to "Power On".

#### Quick physical check — NIC link light

After shutting down the PC, look at the **ethernet port LED** on the back of the machine:

- **Light stays on** → NIC has standby power, BIOS settings are correct
- **Light goes off** → This usually means no standby power, but **WoL can still work on some boards even with the link light off.** Some Realtek NICs (e.g., RTL8125B on MSI X570 boards) don't illuminate the link LED in standby but still listen for magic packets. Don't rely solely on the link light — test with an actual wake command before concluding it's broken.

### 2. Windows — Verify NIC Wake-on-LAN Support

Open an **Administrator PowerShell** and check your network adapters:

```powershell
Get-NetAdapterPowerManagement | Format-List
```

Look for your physical ethernet adapter (not Hyper-V, VirtualBox, or Tailscale). Confirm:

```
WakeOnMagicPacket : Enabled
WakeOnPattern     : Enabled
```

If `WakeOnMagicPacket` shows `Disabled`, enable it:

```powershell
Set-NetAdapterPowerManagement -Name "Ethernet" -WakeOnMagicPacket Enabled
```

Replace `"Ethernet"` with your adapter name (e.g., `"Ethernet 3"`).

### 3. Windows — Verify the Adapter Is Wake-Armed

```powershell
powercfg /devicequery wake_armed
```

Your ethernet adapter must appear in this list. If it doesn't, open Device Manager → Network Adapter → Properties → Power Management tab → check **"Allow this device to wake the computer"**.

### 4. Windows — Get Your MAC Address

```powershell
Get-NetAdapter | Where-Object { $_.Status -eq "Up" -and $_.InterfaceDescription -notlike "*Virtual*" -and $_.InterfaceDescription -notlike "*Hyper-V*" } | Select-Object Name, MacAddress, InterfaceDescription
```

Or for a specific adapter:

```powershell
Get-NetAdapter -Name "Ethernet 3" | Select-Object Name, MacAddress
```

The MAC address will be in `XX-XX-XX-XX-XX-XX` format — both hyphen and colon formats work with `oi-wake-up`.

### 5. Windows — Disable Fast Startup (Critical)

**Fast Startup is the #1 reason WoL fails on modern Windows.** It puts the NIC into a hybrid hibernate state that ignores magic packets.

Check if it's enabled:

```powershell
REG QUERY "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power" /v HiberbootEnabled
```

If the value is `0x1`, Fast Startup is on. Disable it:

```powershell
REG ADD "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power" /v HiberbootEnabled /t REG_DWORD /d 0 /f
```

Alternatively, via the GUI: Control Panel → Power Options → "Choose what the power buttons do" → "Change settings that are currently unavailable" → uncheck **"Turn on fast startup"**.

After disabling, do a **full shutdown** (not restart) for the change to take effect.

### 6. Windows — Realtek NIC Advanced Settings

Realtek 2.5GbE NICs (RTL8125B) have additional power settings that can interfere with WoL. Open Device Manager → Network Adapter → Realtek → Properties → **Advanced** tab and verify:

| Setting | Required Value |
| ------- | -------------- |
| Shutdown Wake-On-Lan | **Enabled** |
| Wake on Magic Packet | **Enabled** |
| Wake on magic packet when system is in S5 | **Enabled** |
| WOL & Shutdown Link Speed | **10 Mbps** |
| Green Ethernet | **Disabled** |
| Power Saving Mode | **Disabled** |
| Energy-Efficient Ethernet | **Disabled** |

The "S5" setting is particularly important — S5 is the full shutdown state. If this is disabled, the NIC stops listening for magic packets after shutdown even if everything else is configured correctly.

> **Important: Use the manufacturer's driver, not the Windows inbox driver.** The generic Realtek driver that ships with Windows does not properly support WoL from S5 (shutdown). Download and install the latest LAN driver from your motherboard manufacturer's website (e.g., [MSI support page](https://www.msi.com/support)). After installing the manufacturer's driver, additional WoL options like "Wake on magic packet when system is in S5" may appear in the Advanced tab that weren't visible before.

### 7. Linux — Verify and Enable WoL

Check current WoL status:

```bash
sudo ethtool <interface> | grep Wake
```

Look for `Wake-on: g` (g = magic packet). If it shows `d` (disabled):

```bash
sudo ethtool -s <interface> wol g
```

To make it persistent across reboots, add a systemd service or NetworkManager config.

## Troubleshooting

### Packet is sent but machine doesn't wake

Work through these checks in order — each step rules out a layer of the stack:

1. **Check the NIC link light on the target PC (when shut down).** Look at the ethernet port LED. If the light is off, the NIC has no standby power — no amount of software configuration will help. Go back to BIOS and disable ErP Ready / Deep Sleep / enable Power On By PCI-E.

2. **Verify the packet is leaving your machine:**
   ```bash
   # In one terminal:
   sudo tcpdump -i any -n udp port 9 -X

   # In another terminal:
   oi-wake-up -i 192.168.1.255 AA:BB:CC:DD:EE:FF
   ```
   You should see a 102-byte UDP packet with `ff ff ff ff ff ff` followed by your MAC repeated 16 times.

3. **Try the subnet broadcast address** instead of the default:
   ```bash
   oi-wake-up -i 192.168.1.255 AA:BB:CC:DD:EE:FF
   ```
   The default `255.255.255.255` doesn't always work on all network configurations. Use your actual subnet broadcast (check with `ifconfig | grep broadcast` on macOS/Linux).

4. **Try waking from Sleep instead of Shutdown.** If Sleep works but Shutdown doesn't, it's a power/BIOS issue — the NIC loses power during full shutdown.

5. **Try port 7 as well as port 9:**
   ```bash
   oi-wake-up -p 7 -i 192.168.1.255 AA:BB:CC:DD:EE:FF
   ```

6. **Send multiple packets.** Some NICs need more than one attempt:
   ```bash
   oi-wake-up -d 1000 AA:BB:CC:DD:EE:FF AA:BB:CC:DD:EE:FF AA:BB:CC:DD:EE:FF
   ```

7. **Check for Realtek-specific driver settings.** Realtek NICs often have additional settings in Device Manager → Network Adapter → Properties → Advanced tab:
   - "Wake on Magic Packet" → **Enabled**
   - "Wake on Magic Packet when System is in the S0ix power state" → **Enabled** (if present)
   - "Energy-Efficient Ethernet" → **Disabled** (can interfere with standby power)
   - "Green Ethernet" → **Disabled**
   - "Power Saving Mode" → **Disabled**

### Diagnostic flowchart

```
Does wake from Sleep work?
├─ NO → OS/driver issue: check WakeOnMagicPacket, wake_armed, NIC Advanced settings
└─ YES → Does wake from Shutdown work?
   ├─ NO → Check these BIOS settings in order:
   │       1. "Resume By PCI-E Device" → Enabled
   │       2. "ErP Ready" → Disabled
   │       3. "Restore on AC Power Loss" → Power On
   │       4. "Network Stack" → Enabled
   │       5. "Deep Sleep" → Disabled
   │       6. Fast Startup (Windows) → Disabled
   └─ YES → Working! ✓
```

> **Note on NIC link light:** Some Realtek NICs don't illuminate the link LED in standby even when WoL is working. Don't use the link light as the sole diagnostic — always test with an actual wake command.

### Common blockers

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| All settings correct, still won't wake | "Restore on AC Power Loss" set to "Power Off" | Set to **"Power On"** in BIOS — controls standby power delivery on some boards (MSI X570 confirmed) |
| Works from Sleep, not Shutdown | Fast Startup enabled | Disable `HiberbootEnabled` (see above) |
| Works from Sleep, not Shutdown (Fast Startup already off) | BIOS deep sleep cutting power in S5 | Disable "Deep Sleep Control" in BIOS |
| NIC not in `wake_armed` list | Power Management not configured | Device Manager → NIC → Power Management → enable wake |
| `WakeOnMagicPacket: Unsupported` | Virtual adapter, not physical NIC | Use the physical ethernet adapter, not Hyper-V/VirtualBox |
| Works locally, not across subnets | Router blocks directed broadcast | Configure router to forward UDP port 9 to subnet broadcast |
| Worked before, stopped working | Windows Update reset NIC driver settings | Re-check `Get-NetAdapterPowerManagement` after updates |
| Realtek NIC — all settings correct but still fails | Realtek power saving features | Disable "Energy-Efficient Ethernet", "Green Ethernet", "Power Saving Mode" in NIC Advanced settings |
| Realtek NIC — missing WoL options in Advanced tab | Using Windows generic inbox driver | Install manufacturer-specific LAN driver from motherboard support page |
| WoL works from Sleep but not Shutdown on Realtek | "Wake on magic packet when system is in S5" missing or disabled | Install MSI/manufacturer driver to expose S5 option, then enable it |
| WoL works only within ~3 minutes of shutdown | NIC drops off the network after ARP entry expires | Use subnet broadcast address (`-i 192.168.1.255`) instead of unicast — broadcast doesn't rely on ARP tables |
| Machine wakes via WoL, then sleeps again ~2 minutes later | Windows "System unattended sleep timeout" (default 120s) returns the machine to sleep after an *unattended* wake | Set it to never — see [Machine wakes, then goes back to sleep](#machine-wakes-then-goes-back-to-sleep-2-minutes-later) below |

### Machine wakes, then goes back to sleep ~2 minutes later

If `oi-wake-up` / `oi-wake-verify` successfully wakes the machine but it becomes unreachable again roughly **two minutes later** (pings stop, an SSH session dies mid-command), the machine is **not** crashing or powering off — it is returning to **sleep** because of the Windows **System unattended sleep timeout**.

When Windows is woken by a *non-user* event — a Wake-on-LAN magic packet or a wake timer — it treats the wake as **unattended** and starts a separate countdown, default **120 seconds**. If no console user becomes present (physical keyboard/mouse) and no running process is holding a system power request, Windows puts the machine back to sleep when that countdown expires.

Two things make this confusing:

- **It is independent of the normal "Sleep after" setting.** The unattended timeout still fires even when "Sleep after" is set to **Never** in Power Options.
- **An SSH session does not count as "user present."** Only console (HID) input or an explicit power request resets it — so SSH-ing in (including SSH into WSL), running a remediation, or holding a connection will **not** keep the machine awake. This is why a remote session gets dropped at the ~2-minute mark.

**Confirm it's this.** In the Windows **System** event log (Event Viewer, or `Get-WinEvent`), you will see this pair repeat ~2 minutes after each wake:

```
Microsoft-Windows-Power-Troubleshooter, Event ID 1:
    "The system has returned from a low power state.  Wake Source: Device - <your NIC>"
Microsoft-Windows-Kernel-Power, Event ID 42:
    "The system is entering sleep.  Sleep Reason: System Idle"
```

A full *shutdown* would instead show Event ID 1074 (process-initiated), 6006 (clean), or 41/6008 (unexpected), and the system uptime would reset. If you only see Event ID 42 with reason **System Idle** and uptime is unbroken, it is the unattended sleep timeout.

**Fix — stay awake until you explicitly sleep it.** In an **elevated** PowerShell or Command Prompt on the target machine, set the unattended sleep timeout to `0` (never):

```powershell
powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP 7bc4a2f9-d8fc-4469-b07b-33eb785aaca0 0
powercfg /setactive SCHEME_CURRENT
```

`7bc4a2f9-d8fc-4469-b07b-33eb785aaca0` is the GUID for "System unattended sleep timeout". It is a **hidden** power setting — it does not appear in the Power Options GUI, and it is *not* shown by a plain `powercfg /query SCHEME_CURRENT SUB_SLEEP`, so you must address it by GUID. Use `0` to stay awake indefinitely (the machine then sleeps only when you put it to sleep manually or with [`oi-wake-down`](#remote-sleep-oi-wake-down)), or a number of seconds (e.g. `1800` for a 30-minute auto-sleep safety net).

**Verify the value** (it lives in the registry because it is hidden from `powercfg /query`):

```powershell
$rk = "HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes\$((powercfg /getactivescheme) -replace '.*GUID: ([0-9a-f-]+).*','$1')\238c9fa8-0aad-41ed-83f4-97be242c8f20\7bc4a2f9-d8fc-4469-b07b-33eb785aaca0"
(Get-ItemProperty $rk).ACSettingIndex   # 0 = Never
```

**Revert** by re-running the `setacvalueindex` command with `120` (the default) in place of `0`.

> This setting only governs what happens *after* an unattended wake; it does not change how the machine sleeps on demand. Wake with `oi-wake-up` / `oi-wake-verify`, sleep with `oi-wake-down`.

### Recording external wakes (wakes `oi-wake-verify` never sees)

`oi-wake-verify --capture-wake-source` attributes the wakes *you* trigger. But the wakes a "why does my box keep turning on?" investigation cares about most are the ones **nobody triggered through the tool** — an external magic packet, ordinary LAN traffic when the NIC has **WakeOnPattern** enabled, a HID device (keyboard/mouse), or a wake timer. `oi-wake-verify` only runs when you wake the box, so it structurally *cannot* observe these. To get a complete wake history you record them **on the Windows side**, then union that stream with your `oi-wake-verify` journal.

This is **documentation, not a shipped binary** — an always-on recorder is a daemon, which is out of scope for this project (see [DECISIONS.md](docs/DECISIONS.md) — "daemon = separate tool's job"). The recipe below is read-only: it only *reads* `powercfg /lastwake`, never changes power policy ([Decision #19](docs/DECISIONS.md)).

**The idea:** a Windows **Task Scheduler** job triggered on each resume — Power-Troubleshooter **Event ID 1** (System log) and/or Kernel-Power **Event ID 107** — that appends one JSONL line per wake, in a shape that mirrors the `oi-wake-verify` journal (`{ts, wakeSource}`), to a path readable from WSL.

1. **Recorder script** — save as `C:\ProgramData\oi-wake\record-wake.ps1`:

   ```powershell
   $dir = 'C:\ProgramData\oi-wake'
   New-Item -ItemType Directory -Force -Path $dir | Out-Null
   $raw = (& "$env:SystemRoot\System32\powercfg.exe" /lastwake | Out-String)
   $type = ($raw -split "`n" | Where-Object { $_ -match '^\s*Type\s*[:\-]' } |
            ForEach-Object { ($_ -split '[:\-]', 2)[1].Trim() } | Select-Object -First 1)
   $desc = ($raw -split "`n" | Where-Object { $_ -match '^\s*Description\s*[:\-]' } |
            ForEach-Object { ($_ -split '[:\-]', 2)[1].Trim() } | Select-Object -First 1)
   $record = [ordered]@{
       ts         = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
       host       = $env:COMPUTERNAME
       source     = 'external-wake-recorder'
       wakeSource = [ordered]@{ captured = $true; type = $type; description = $desc; raw = $raw.Trim() }
   }
   Add-Content -Path (Join-Path $dir 'external-wakes.jsonl') -Value ($record | ConvertTo-Json -Compress -Depth 5)
   ```

   The recorder's `ts` is the script's **run time**, not a `powercfg` field (`/lastwake` carries no timestamp). Because the task fires on the Event ID 1 *resume*, run time is within a second or two of the actual wake — fine for timestamp-window correlation. For an exact wake time, read the triggering Event ID 1 instead.

2. **Register the trigger** (elevated PowerShell) — fire on Power-Troubleshooter Event ID 1:

   ```powershell
   $action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
       -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\ProgramData\oi-wake\record-wake.ps1"'
   $trigger = New-ScheduledTaskTrigger -AtStartup       # placeholder; replaced by the event subscription below
   Register-ScheduledTask -TaskName 'oi-wake external recorder' -Action $action -Trigger $trigger `
       -User 'SYSTEM' -RunLevel Highest -Force

   # Swap the trigger for an event subscription on Power-Troubleshooter Event ID 1:
   $task = Get-ScheduledTask -TaskName 'oi-wake external recorder'
   $cls  = Get-CimClass MSFT_TaskEventTrigger root/Microsoft/Windows/TaskScheduler
   $evt  = New-CimInstance -CimClass $cls -ClientOnly
   $evt.Subscription = '<QueryList><Query Id="0"><Select Path="System">*[System[Provider[@Name=''Microsoft-Windows-Power-Troubleshooter''] and (EventID=1)]]</Select></Query></QueryList>'
   $task.Triggers = @($evt)
   Set-ScheduledTask -TaskName 'oi-wake external recorder' -Trigger $task.Triggers
   ```

   **Installing remotely over SSH (WSL).** If you script the steps above over a non-interactive WSL SSH session, run each `powershell.exe` call as the *last / standalone* command in its SSH invocation, and keep `-NoProfile`: WSL→Windows interop can disturb the shared stdout stream when a `powershell.exe` call is chained mid-pipe (`powershell.exe … && <more bash>`), truncating the bash output that follows. Smoke-test the recorder the same way — `powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\ProgramData\oi-wake\record-wake.ps1'` — then check `external-wakes.jsonl`.

3. **Read it from WSL / your dispatcher** — the log is at `/mnt/c/ProgramData/oi-wake/external-wakes.jsonl`. Because each line mirrors the `oi-wake-verify` journal (`ts` + `wakeSource`), a consumer can simply concatenate both streams and sort by `ts` to get one durable wake history that distinguishes "we woke it" (a record from `oi-wake-verify --capture-wake-source`) from "something else woke it" (a record from this recorder with no matching tool run).

See also: [WakeOnMagicPacket / WakeOnPattern](#6-windows--realtek-nic-advanced-settings) and Realtek NIC settings (a `WakeOnPattern`-armed NIC wakes on ordinary LAN traffic, the usual cause of "random" daytime wakes), the [System unattended sleep timeout](#machine-wakes-then-goes-back-to-sleep-2-minutes-later) (the usual cause of a box re-sleeping ~2 min after a wake), and the Event ID 1 / 42 pair documented above.

### Time-limited wake window

Some Realtek NICs (particularly on X570 boards) only respond to magic packets for a few minutes after shutdown. After that, the NIC appears to go into a deeper sleep state and stops listening. This has been reported by multiple users in MSI forums.

**Why this happens:** When the PC shuts down, the router's ARP table entry for the PC expires (typically 1-5 minutes). Once the ARP entry is gone, unicast packets can't reach the NIC. However, **WoL magic packets sent to the subnet broadcast address bypass ARP entirely** — they're delivered to all devices on the segment at the ethernet layer.

**Mitigations:**
- **Always use the subnet broadcast address:** `oi-wake-up -i 192.168.1.255 <mac>` — this is the most reliable method regardless of ARP state
- **Set a static ARP entry on your router** for the target PC's MAC/IP — prevents the entry from expiring
- **Send the wake command promptly** if the time-limited behavior persists even with broadcast
- **Check "WOL & Shutdown Link Speed"** in NIC Advanced settings — set to **10 Mbps**. Some NICs in 2.5G mode drop the link entirely in standby; forcing 10 Mbps keeps the low-power link alive

### Network considerations

- **Same subnet:** WoL works by broadcast — both machines must be on the same subnet/VLAN unless your router is configured for directed broadcast forwarding.
- **Guest networks:** Most routers isolate guest network clients from each other. WoL won't work across guest network isolation.
- **Managed switches:** Some managed switches filter broadcast traffic. Check switch settings if using enterprise-grade networking.
- **Wi-Fi → Wired:** Sending a WoL packet from a Wi-Fi device to wake a wired device works fine — the broadcast reaches the wired segment through the router/AP.

## License

MIT
