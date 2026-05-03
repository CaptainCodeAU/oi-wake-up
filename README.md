# oi-wake-up

Wake-on-LAN done right. No dependencies, just Node.js.

## Install

### From GitHub (one-liner)

```bash
pnpm add -g github:CaptainCodeAU/oi-wake-up
```

### Local development

```bash
git clone https://github.com/CaptainCodeAU/oi-wake-up.git
cd oi-wake-up
pnpm install
pnpm link --global
```

Because this project has zero runtime dependencies, global install via either method is risk-free — no version conflicts, no transitive surface, nothing to audit. Use bun (`bun add -g github:CaptainCodeAU/oi-wake-up`) if you prefer; npm is not supported for this project.

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
oi-wake-verify rtx3090 \
    --mac 04:7C:16:40:B4:B3 \
    --remediate "bash -lc 'cd ~/repos/llmster-server-3090 && just restart'" \
    --verify   "bash -lc 'cd /home/winadmin/repos/llmster-server-3090 && just warmup'"

# Just send the magic packet (don't wait, don't remediate).
oi-wake-verify rtx3090 --mac 04:7C:16:40:B4:B3 --wake-only

# Already awake? Force the remediation anyway.
oi-wake-verify rtx3090 --mac 04:7C:16:40:B4:B3 --force \
    --remediate "bash -lc 'cd ~/repos/llmster-server-3090 && just restart'" \
    --verify   "bash -lc 'cd /home/winadmin/repos/llmster-server-3090 && just warmup'"

# Show what would happen without doing anything.
oi-wake-verify rtx3090 --mac 04:7C:16:40:B4:B3 --dry-run -v
```

**On `--grace`**: applies twice on the wake-and-remediate path — once after SSH comes up (services may not be ready yet), once after `--remediate` runs (just-restarted services may not be ready yet). The default `10` is reasonable when your `--verify` command handles its own readiness wait (e.g. polls until the API can actually serve a request). Bump it if your verify is naive about timing — the cost of being wrong is a `verify failed` exit 5 on a healthy host.

**On wrapping commands in `bash -lc '…'`**: SSH non-interactive command execution uses the target's login shell. If that shell is zsh and your binaries (`just`, project scripts, etc.) are on PATH only via bash's profile, the command will fail with `command not found`. Wrapping the remediate and verify in `bash -lc '…'` forces a bash login shell with full PATH initialisation. Safe even when the target's default shell is bash.

**On `--journal <path>`**: appends a JSON record (one line, JSONL) to `<path>` on every run. Useful for cron wrappers, Home Assistant automations, or any consumer that wants a persistent audit trail.

**On `--retry-wake <n>`**: if SSH never comes up within `--timeout`, re-sends the magic packet and re-polls up to `n` additional times before giving up. Useful when the first packet hits the network during MAC-table churn.

**On `--max-output <bytes>`**: caps the stdout + stderr captured from `--remediate` and `--verify` commands (default: 1 MiB). Chatty commands get truncated at the limit with a `[output truncated]` marker; they don't balloon memory or flood the journal.

Run `oi-wake-verify --help` for the full flag reference.

### A note on what `--verify` should actually exercise

Pick a verify command that exercises the **failing layer**, not an adjacent one. The motivating case here — Windows sleep/wake silently breaks the docker container's GPU passthrough — is a useful illustration of how easy it is to verify the wrong thing:

- `docker exec llmster nvidia-smi` looks like it tests the GPU, but it doesn't. `nvidia-smi` exits 0 even when the container has lost CUDA access (the `"GPU access blocked"` text goes to stdout, not the exit code). The verify can pass while inference is silently running on CPU at 5–30× the latency.
- A timed inference call — even a 5-token completion against the smallest loaded model — does test the layer that actually matters. If GPU is healthy you get sub-second latency; on CPU fallback you get seconds.

The example above delegates that decision to a `just warmup` recipe on the target host, which keeps the threshold logic colocated with the models and runtime it depends on. The general principle: your verify should fail when a real workload would.

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
| 130  | Interrupted (SIGINT) |

These are stable — branch on them from cron, Home Assistant, shell wrappers.

### Recommended setup: lean on `~/.ssh/config`

Define the SSH connection details once in `~/.ssh/config`, then the shell alias only carries the wake/remediate bits:

```sshconfig
# ~/.ssh/config
Host rtx3090
    HostName        192.168.1.56
    User            captain
    Port            2522                 # WSL-side sshd, NOT Windows-OpenSSH
    IdentityFile    ~/.ssh/mlbox
    IdentitiesOnly  yes
```

```bash
# ~/.zshrc (or ~/.bashrc)
alias rtx3090-wake='oi-wake-verify rtx3090 \
    --mac 04:7C:16:40:B4:B3 \
    --remediate "bash -lc \"cd ~/repos/llmster-server-3090 && just restart\"" \
    --verify   "bash -lc \"cd /home/winadmin/repos/llmster-server-3090 && just warmup\""'
```

**Why port 2522?** SSHing directly to the WSL Ubuntu sshd lands the remediation in `bash`, with normal POSIX quoting and key auth. SSHing to Windows OpenSSH on port 22 lands in PowerShell, which (a) parses commands with PowerShell rules instead of bash, (b) breaks `ssh-copy-id`, and (c) requires `wsl.exe -d Ubuntu --` shimming and the `C:\ProgramData\ssh\administrators_authorized_keys` quirk for Admin accounts. Use the WSL-direct path when you can. The Windows-OpenSSH path works as a fallback — just expect to rewrite the `--remediate` string in PowerShell-friendly form.

### Install

This binary ships in the same package as `oi-wake-up`. Once installed (see [Install](#install) above), both `oi-wake-up` and `oi-wake-verify` are on your `PATH`. **Zero runtime dependencies** — global install via `pnpm link --global` or `pnpm add -g github:CaptainCodeAU/oi-wake-up` is risk-free: no version conflicts, no transitive surface, nothing to audit.

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
import { decideAction, executePlan, EXIT } from 'oi-wake-up/verify';

const opts = parseVerifyArgs(['myhost', '--mac', 'AA:BB:CC:DD:EE:FF']);
const plan = decideAction('unreachable', opts);
const journal = await executePlan(plan, opts, { log });
// journal.exit_code is one of the EXIT values
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
