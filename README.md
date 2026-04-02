# oi-wake-up

Wake-on-LAN done right. No dependencies, just Node.js.

## Install

```bash
npm install -g oi-wake-up
```

Or use as a library:

```bash
npm install oi-wake-up
```

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

## Library Usage

```javascript
import { wake, createMagicPacket, parseMAC, isValidMAC } from 'oi-wake-up';

// Send a magic packet (defaults: broadcast 255.255.255.255, port 9)
await wake('AA:BB:CC:DD:EE:FF');

// With options
await wake('AA:BB:CC:DD:EE:FF', {
  address: '192.168.1.255',
  port: 7,
});

// Build a packet manually
const packet = createMagicPacket('AA:BB:CC:DD:EE:FF'); // 102-byte Buffer

// Validate a MAC address
isValidMAC('AA:BB:CC:DD:EE:FF'); // true
isValidMAC('not-a-mac');         // false

// Parse a MAC address
const buf = parseMAC('AA:BB:CC:DD:EE:FF'); // 6-byte Buffer
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

## License

MIT
