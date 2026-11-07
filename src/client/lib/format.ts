export function fmtChips(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + "M";
  if (Math.abs(n) >= 10_000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k";
  return n.toLocaleString();
}

export function fmtNet(n: number): string {
  return (n > 0 ? "+" : "") + n.toLocaleString();
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}
