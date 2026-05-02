# Glossary

Wake-on-LAN terminology used throughout this project's docs.

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
