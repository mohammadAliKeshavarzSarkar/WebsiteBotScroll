export interface RobotsRule {
  allow: boolean;
  path: string;
}

export type RobotsDecisionSource = {
  kind: "rules" | "allow-all" | "temporary-disallow";
  sitemaps: string[];
  expiresAt: number;
  groups?: Array<{ agents: string[]; rules: RobotsRule[] }>;
};

function rulesFor(source: RobotsDecisionSource, userAgent: string): RobotsRule[] {
  const agent = userAgent.toLowerCase();
  const candidates = (source.groups ?? []).map((group) => ({
    group,
    score: Math.max(...group.agents.map((token) => token === "*" ? 0 : agent.includes(token) ? token.length : -1)),
  }));
  const best = Math.max(-1, ...candidates.map(({ score }) => score));
  return candidates.filter(({ score }) => score === best && score >= 0).flatMap(({ group }) => group.rules);
}

export function canCrawl(source: RobotsDecisionSource, url: URL, userAgent: string): boolean {
  if (source.kind === "temporary-disallow") return false;
  if (source.kind === "allow-all") return true;

  const target = `${url.pathname}${url.search}`;
  const matching = rulesFor(source, userAgent)
    .filter((rule) => rule.path !== "" && target.startsWith(rule.path))
    .sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matching[0]?.allow ?? true;
}
