# Glossary

Wake-on-LAN terminology used throughout this project's docs.

## `--grace` (oi-wake-verify)
Settle-time inserted between state-changing transitions and the steps that depend on them. On the asleep-and-remediate path, `--grace` runs twice: once after SSH comes up (services may not be ready yet), once after `--remediate` runs (just-restarted services may not be ready yet). Default is 10s; the worked example for the 3090 GPU-rebind workflow uses 25s because the docker container needs ~15–25s post-restart before the model server can serve a real completion request.

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

## S5 state
ACPI "soft off" — full shutdown, but with standby power still flowing to the motherboard. WoL from S5 requires the NIC and BIOS to cooperate. Some Realtek drivers expose a separate "Wake on magic packet when system is in S5" toggle that must be enabled.

## Subnet broadcast
A broadcast address scoped to a specific subnet (e.g. `192.168.1.255` for `192.168.1.0/24`). More reliably delivered than the global `255.255.255.255` because routers and managed switches handle subnet broadcast predictably.

## Sync stream
The 6 bytes of `0xFF` at the start of a magic packet. Lets a NIC's WoL logic detect the start of a wake payload before checking the MAC repetitions that follow.

## Wake-on-LAN (WoL)
The protocol implemented by this project: wake a sleeping or shutdown computer by sending a magic packet to its NIC over the network. Originally an AMD/Intel specification from 1995, now ubiquitous on consumer and server hardware.

## warmup recipe (3090-side)
A `just warmup` recipe in the user's `llmster-server-3090` repo that exercises the actual inference path against the local model server (`localhost:1234`). Sends a cold completion call (paying any JIT-load cost), then a hot completion call, and gates on hot latency being under a threshold. Output is the parseable line `cold_ms=N hot_ms=N threshold_ms=N` to stdout. Used as the canonical `--verify` for `oi-wake-verify` because it tests the layer that actually matters — the GPU/CPU latency gap is ~30× under the threshold for a healthy GPU and 10–30× over for CPU fallback, so a single threshold cleanly separates the two states. See `docs/ROADMAP.md` and the README's worked example.

## broken-CUDA-handle (post-resume)
The failure mode that motivated `oi-wake-verify`. When Windows sleeps and resumes, the docker container's CUDA device handle becomes stale — the container falls back to CPU silently, with no error returned at the binary level. `nvidia-smi` exits 0 even when GPU access is blocked from inside the container (the failure message is in stdout, not the exit code). `docker restart llmster` (or `just restart` in the llmster repo) re-establishes GPU passthrough in 5–10s; the user's `--verify` should be a real timed inference call, not `nvidia-smi`, because the latter is the wrong layer.

## BatchMode (SSH)
The `BatchMode=yes` SSH option used by `oi-wake-verify`'s probe and remote-command paths. Disables interactive prompts (host-key acceptance, passphrase requests, password fallback). A connection that would normally show "Are you sure you want to continue connecting?" fails with `Host key verification failed.` instead — visible only at `-d` verbosity in the current implementation (a v1.2 candidate is to surface this at default verbosity).

## host key entry
A line in `~/.ssh/known_hosts` that records the public key SSH expects from a given host. Each entry is keyed by `hostname` or `[hostname]:port` for non-default ports. Default port (22) entries don't match non-default ports — SSHing to the same physical machine on port 22 and port 2522 needs two separate `known_hosts` lines. The entry can be added interactively (typing `yes` when SSH prompts) or via the `--ssh-opt StrictHostKeyChecking=accept-new` pass-through (`oi-wake-verify` writes the entry as a side-effect of its first probe).
