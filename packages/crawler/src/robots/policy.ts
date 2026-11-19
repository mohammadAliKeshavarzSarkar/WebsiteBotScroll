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

export interface RobotsEvaluation {
  allowed: boolean;
  userAgent: string;
  matchedRule: RobotsRule | null;
  sourceKind: RobotsDecisionSource["kind"];
}

function rulesFor(source: RobotsDecisionSource, userAgent: string): RobotsRule[] {
  const agent = userAgent.toLowerCase();
  const candidates = (source.groups ?? []).map((group) => ({
    group,
    score: Math.max(...group.agents.map((token) => token === "*" ? 0 : agent.includes(token) ? token.length : -1)),
  }));
  const best = Math.max(-1, ...candidates.map(({ score }) => score));
  return candidates.filter(({ score }) => score === best && score >= 0).flatMap(({ group }) => group.rules);
}

export function evaluateCrawl(source: RobotsDecisionSource, url: URL, userAgent: string): RobotsEvaluation {
  if (source.kind === "temporary-disallow") return { allowed: false, userAgent, matchedRule: null, sourceKind: source.kind };
  if (source.kind === "allow-all") return { allowed: true, userAgent, matchedRule: null, sourceKind: source.kind };

  const target = `${url.pathname}${url.search}`;
  const matching = rulesFor(source, userAgent)
    .filter((rule) => rule.path !== "" && target.startsWith(rule.path))
    .sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  const matchedRule = matching[0] ?? null;
  return { allowed: matchedRule?.allow ?? true, userAgent, matchedRule, sourceKind: source.kind };
}

export function canCrawl(source: RobotsDecisionSource, url: URL, userAgent: string): boolean {
  return evaluateCrawl(source, url, userAgent).allowed;
}
