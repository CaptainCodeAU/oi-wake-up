# Glossary

Wake-on-LAN terminology used throughout this project's docs.

## `--grace` (oi-wake-verify)
Settle-time inserted between state-changing transitions and the steps that depend on them. On the asleep-and-remediate path, `--grace` runs twice: once after SSH comes up (services may not be ready yet), once after `--remediate` runs (just-restarted services may not be ready yet). Default is 10s and is sufficient when the `--verify` command does its own readiness wait (e.g. polls until the API can serve a real request before returning). Bump it only for naive verifiers that fire immediately and assume the service is ready. The 3090 GPU-rebind worked example originally needed `--grace 25` while the `just warmup` recipe was naive about timing; once the recipe was made self-sufficient (DECISIONS #11, 2026-05-02 PM), the example was rolled back to the default 10s.

## ARP (Address Resolution Protocol)
Maps IP addresses to MAC addresses on a local network. Routers cache ARP entries; when an entry expires (typically 1–5 minutes after a host stops responding), unicast packets to that IP no longer reach the host. Subnet broadcast bypasses ARP entirely — relevant to time-limited wake windows (see README troubleshooting).

## Broadcast address
A special IP that delivers a packet to every host on a network segment. Two flavours: `255.255.255.255` (limited broadcast, often filtered or unevenly delivered by routers) and the **subnet broadcast** (e.g. `192.168.1.255` for a `192.168.1.0/24` network, generally more reliable).

## Deep Sleep (BIOS)
Motherboard setting that cuts standby power to maintain ultra-low energy use. When enabled, the NIC loses power and cannot listen for magic packets — disabling Deep Sleep is required for WoL from S5 (full shutdown).

## ErP Ready
EU energy-regulation mode that drops the system into the lowest possible standby state, cutting power to the NIC. The most common silent blocker of WoL — must be **Disabled** in BIOS.

## Fast Startup (Windows)
A hybrid hibernate state that Windows uses by default for shutdown. The NIC ignores magic packets in this state. **Disabling Fast Startup is the #1 fix for "WoL works from Sleep but not Shutdown" on modern Windows** — see README troubleshooting.

## Magic packet
The 102-byte UDP payload that triggers Wake-on-LAN: 6 bytes of `0xFF` (sync stream) followed by the target MAC address repeated 16 times. Conventionally sent to UDP port 7 ("echo") or port 9 ("discard"); port 9 is more common.

## MAC address
Media Access Control address — a 6-byte hardware identifier baked into a NIC. WoL targets the MAC, not the IP, so the NIC can wake the host even when no IP is configured. Common formats: colon-delimited (`AA:BB:CC:DD:EE:FF`), hyphen-delimited (`AA-BB-CC-DD-EE-FF`), and bare (`AABBCCDDEEFF`).

## NIC (Network Interface Controller)
The network adapter — the ethernet card or chip. For WoL to work, the NIC must (a) have standby power, (b) recognise magic packets containing its own MAC, and (c) signal the motherboard to power on. Realtek RTL8125B and Intel I219/I225 families are common on consumer boards.

## S3 state (Sleep / Suspend-to-RAM)
ACPI "suspend to RAM" — the machine's CPU and peripherals are powered off, but RAM retains its contents with a small trickle of power. Boot time on resume is fast (~1–3s). Wake-on-LAN reliably triggers an S3 wake on correctly configured hardware. The `oi-wake-down` default (`rundll32 SetSuspendState 0,1,0`) targets S3.

## S4 state (Hibernate / Suspend-to-Disk)
ACPI "suspend to disk" — RAM contents are saved to the disk and power is cut entirely. Resume requires reading back from disk (~10–30s). WoL can work from S4 on some hardware, but behaviour varies. `SetSuspendState` falls through to S4 if Windows hibernation is enabled (`powercfg /h on`). To ensure S3 (sleep) rather than S4 (hibernate), run `powercfg /h off` on the Windows side — a one-time setup step. The two states are also the difference between `powercfg /a` reporting "Hibernate" vs. "Stand by (S3)" as an available power state.

## S5 state
ACPI "soft off" — full shutdown, but with standby power still flowing to the motherboard. WoL from S5 requires the NIC and BIOS to cooperate. Some Realtek drivers expose a separate "Wake on magic packet when system is in S5" toggle that must be enabled.

## Subnet broadcast
A broadcast address scoped to a specific subnet (e.g. `192.168.1.255` for `192.168.1.0/24`). More reliably delivered than the global `255.255.255.255` because routers and managed switches handle subnet broadcast predictably.

## Sync stream
The 6 bytes of `0xFF` at the start of a magic packet. Lets a NIC's WoL logic detect the start of a wake payload before checking the MAC repetitions that follow.

## Wake-on-LAN (WoL)
The protocol implemented by this project: wake a sleeping or shutdown computer by sending a magic packet to its NIC over the network. Originally an AMD/Intel specification from 1995, now ubiquitous on consumer and server hardware.

## warmup recipe (3090-side)
A `just warmup` recipe in the GPU host's project repo that exercises the actual inference path against the local model server (`localhost:1234`). Sends a cold completion call (paying any JIT-load cost), then a hot completion call, and gates on hot latency being under a threshold. Output is the parseable line `cold_ms=N hot_ms=N threshold_ms=N` to stdout. Used as the canonical `--verify` for `oi-wake-verify` because it tests the layer that actually matters — the GPU/CPU latency gap is ~30× under the threshold for a healthy GPU and 10–30× over for CPU fallback, so a single threshold cleanly separates the two states. See `docs/ROADMAP.md` and the README's worked example.

## broken-CUDA-handle (post-resume)
The failure mode that motivated `oi-wake-verify`. When Windows sleeps and resumes, the docker container's CUDA device handle becomes stale — the container falls back to CPU silently, with no error returned at the binary level. `nvidia-smi` exits 0 even when GPU access is blocked from inside the container (the failure message is in stdout, not the exit code). `docker restart <container>` (or `just restart` in the project repo) re-establishes GPU passthrough in 5–10s; the user's `--verify` should be a real timed inference call, not `nvidia-smi`, because the latter is the wrong layer.

## BatchMode (SSH)
The `BatchMode=yes` SSH option used by `oi-wake-verify`'s probe and remote-command paths. Disables interactive prompts (host-key acceptance, passphrase requests, password fallback). A connection that would normally show "Are you sure you want to continue connecting?" fails with `Host key verification failed.` instead. As of v1.4.0 the probe's failure reason (host-key mismatch, connection timeout, refused, sshd-down) is surfaced at default verbosity, not just `-d` — see DECISIONS #20.

## host key entry
A line in `~/.ssh/known_hosts` that records the public key SSH expects from a given host. Each entry is keyed by `hostname` or `[hostname]:port` for non-default ports. Default port (22) entries don't match non-default ports — SSHing to the same physical machine on port 22 and port 2522 needs two separate `known_hosts` lines. The entry can be added interactively (typing `yes` when SSH prompts) or via the `--ssh-opt StrictHostKeyChecking=accept-new` pass-through (`oi-wake-verify` writes the entry as a side-effect of its first probe).

## System unattended sleep timeout (UNATTENDSLP)
Hidden Windows power setting (GUID `7bc4a2f9-d8fc-4469-b07b-33eb785aaca0`) that controls how long the machine stays awake after an **unattended** wake — one triggered by a non-user event such as a Wake-on-LAN magic packet or a wake timer. Default is **120 seconds**: if no console user becomes present (physical keyboard/mouse) and no process holds a system power request, Windows returns the machine to sleep when the countdown expires. It is **independent of the normal "Sleep after" timeout** — it fires even when "Sleep after" is set to *Never* — and is the usual reason a WoL-woken box becomes unreachable ~2 minutes later. An SSH session, **including SSH into WSL, does not count as user presence** and will not reset it. The setting is hidden: it does not appear in the Power Options GUI or in `powercfg /query SCHEME_CURRENT SUB_SLEEP`, so it must be addressed by GUID. Set it to `0` to keep the host awake until explicitly slept (e.g. via `oi-wake-down`): `powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP 7bc4a2f9-d8fc-4469-b07b-33eb785aaca0 0 && powercfg /setactive SCHEME_CURRENT`. See README troubleshooting ("Machine wakes, then goes back to sleep ~2 minutes later") and DECISIONS #19.

## Hybrid Sleep (Windows)
A sleep mode that combines S3 and S4: on sleep Windows keeps RAM powered (like S3) *and* writes a hibernation image to disk (like S4). Resume is fast from RAM under normal conditions; if power is lost while asleep, the machine recovers from the disk image instead of cold-booting. Default-on for desktops. Disabled — along with hibernate and Fast Startup — by `powercfg /h off`, which leaves only plain S3 sleep available. Relevant because a host configured for sleep-only (S3, hibernate off) gives `oi-wake-down`'s `SetSuspendState` a predictable fast-sleep target with no hibernate substitution (the S4 gotcha above).

## ConnectTimeout / ServerAlive (SSH)
Two SSH options `oi-wake-verify` sets on the `--remediate` and `--verify` command channels (added v1.4.0). `ConnectTimeout=10` bounds how long the client waits to *establish* the TCP connection — without it, a stalled connect (e.g. a target whose network stack hasn't recovered after a WoL wake) rides OpenSSH's default, roughly the kernel's `tcp_syn_retries` budget (~120s). `ServerAliveInterval=5` + `ServerAliveCountMax=3` send keepalive probes on an otherwise-idle channel and give up after ~15s, catching a connection that goes silent *mid-command* (a half-open link, a stale `ControlMaster` socket). Together they convert a multi-minute hang into a fast, clean failure (exit 4/5) that a calling wrapper can buffer and retry. Deliberately scoped to the remediate/verify channels only — the pre-flight probe has its own `--probe-timeout`, and `oi-wake-down`'s sleep channel relies on the connection dropping. See DECISIONS #20.
