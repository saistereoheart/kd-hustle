import os from 'node:os';

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
// Virtual adapters (WSL, Hyper-V, VirtualBox, VMware, Docker) that phones can't reach.
const VIRTUAL = /(vEthernet|VirtualBox|VMware|Hyper-V|WSL|docker|vbox|Loopback|Bluetooth|ZeroTier|Tailscale|Hamachi|VPN|TAP)/i;

// Virtual-LAN overlays that let friends on other WiFi/mobile data join (Tailscale uses 100.64.0.0/10).
const OVERLAY = /(ZeroTier|Tailscale)/i;
const CGNAT = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

export interface LanAddress {
  name: string;
  address: string;
  likely: boolean;
  /** ZeroTier / Tailscale: reachable by players on other networks who joined the same virtual network. */
  overlay: boolean;
}

/** Non-internal IPv4 addresses: WiFi/Ethernet first, then ZeroTier/Tailscale, then the rest. */
export function lanAddresses(): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const overlay = OVERLAY.test(name) || CGNAT.test(info.address);
      out.push({ name, address: info.address, likely: !overlay && PRIVATE.test(info.address) && !VIRTUAL.test(name), overlay });
    }
  }
  const rank = (a: LanAddress) => (a.likely ? 2 : a.overlay ? 1 : 0);
  return out.sort((a, b) => rank(b) - rank(a));
}
