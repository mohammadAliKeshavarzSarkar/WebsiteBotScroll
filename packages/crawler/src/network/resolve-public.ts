import { isIP } from "node:net";

export interface DnsResolver {
  resolve(hostname: string): Promise<readonly string[]>;
}

export interface ResolvedDestination {
  hostname: string;
  address: string;
  family: 4 | 6;
}

export class UnsafeDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDestinationError";
  }
}

function parseIpv4(address: string): number | undefined {
  if (isIP(address) !== 4) return undefined;
  return address.split(".").reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0;
}

function isInIpv4Range(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function isPublicIpv4(address: string): boolean {
  const value = parseIpv4(address);
  if (value === undefined) return false;

  const forbidden: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  return !forbidden.some(([base, prefix]) => isInIpv4Range(value, parseIpv4(base)!, prefix));
}

function expandIpv6(input: string): number[] | undefined {
  let address = input.toLowerCase().split("%")[0]!;
  const ipv4Match = address.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const ipv4 = parseIpv4(ipv4Match[1]!);
    if (ipv4 === undefined) return undefined;
    address = address.slice(0, -ipv4Match[1]!.length) + `${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || omitted < 0) return undefined;
  const groups = [...left, ...Array(omitted).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  return groups.map((part) => Number.parseInt(part, 16));
}

function isPublicIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups) return false;

  const isMappedIpv4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isMappedIpv4) {
    const embedded = `${groups[6]! >>> 8}.${groups[6]! & 255}.${groups[7]! >>> 8}.${groups[7]! & 255}`;
    return isPublicIpv4(embedded);
  }

  const isGlobalUnicast = (groups[0]! & 0xe000) === 0x2000;
  const isDocumentation = groups[0] === 0x2001 && groups[1] === 0x0db8;
  return isGlobalUnicast && !isDocumentation;
}

function isPublicAddress(address: string): address is string {
  const family = isIP(address);
  return family === 4 ? isPublicIpv4(address) : family === 6 ? isPublicIpv6(address) : false;
}

function literalHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export async function assertAllowedDestination(url: URL, resolver: DnsResolver): Promise<ResolvedDestination> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeDestinationError(`Unsupported destination scheme: ${url.protocol}`);
  }

  const hostname = literalHostname(url.hostname).toLowerCase();
  const literalFamily = isIP(hostname);
  const addresses = literalFamily ? [hostname] : [...(await resolver.resolve(hostname))];
  if (addresses.length === 0) throw new UnsafeDestinationError("Destination did not resolve");

  const unsafe = addresses.find((address) => !isPublicAddress(address));
  if (unsafe) throw new UnsafeDestinationError(`Destination resolved to a forbidden address: ${unsafe}`);

  const address = addresses[0]!;
  return { hostname, address, family: isIP(address) as 4 | 6 };
}
