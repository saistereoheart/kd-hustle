import os from 'node:os';

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
// Virtual adapters (WSL, Hyper-V, VirtualBox, VMware, Docker) that phones can't reach.
const VIRTUAL = /(vEthernet|VirtualBox|VMware|Hyper-V|WSL|docker|vbox|Loopback|Bluetooth|ZeroTier|Tailscale|Hamachi|VPN|TAP)/i;

export interface LanAddress {
  name: string;
  address: string;
  likely: boolean;
}

/** Non-internal IPv4 addresses, most-likely-WiFi/Ethernet first. */
export function lanAddresses(): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      out.push({ name, address: info.address, likely: PRIVATE.test(info.address) && !VIRTUAL.test(name) });
    }
  }
  return out.sort((a, b) => Number(b.likely) - Number(a.likely));
}
