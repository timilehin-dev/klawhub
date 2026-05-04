import { getDb } from "./connection";
import { engineerLearnings } from "./schema";
import { eq, sql, desc, and, or, ilike } from "drizzle-orm";

type SaveLearningInput = {
  language: string;
  domain: string;
  taskType: string;
  mistake: string;
  correction: string;
  verdict: "pass" | "fail";
  specSnippet?: string;
  codeSnippet?: string;
  runId?: string;
};

/**
 * Save a QA learning for the engineer to reference in future builds.
 */
export async function saveEngineerLearning(input: SaveLearningInput): Promise<void> {
  const db = getDb();
  await db.insert(engineerLearnings).values({
    language: input.language,
    domain: input.domain.slice(0, 200),
    taskType: input.taskType.slice(0, 200),
    mistake: input.mistake.slice(0, 2000),
    correction: input.correction.slice(0, 2000),
    verdict: input.verdict,
    specSnippet: input.specSnippet?.slice(0, 1000),
    codeSnippet: input.codeSnippet?.slice(0, 1000),
    runId: input.runId,
  });
}

/**
 * Retrieve relevant past learnings for a given language and domain.
 * Returns the most recent learnings that match, limited to a token budget.
 */
export async function getRelevantLearnings(
  language: string,
  requestText: string,
  limit = 20
): Promise<string> {
  const db = getDb();

  // Extract potential domain keywords from the request
  const keywords = extractDomainKeywords(requestText);

  // Query for recent learnings matching language and any domain keywords
  const rows = await db
    .select()
    .from(engineerLearnings)
    .where(
      and(
        eq(engineerLearnings.language, language),
        // Prioritize FAIL verdicts (mistakes to avoid)
        or(
          eq(engineerLearnings.verdict, "fail"),
          eq(engineerLearnings.verdict, "pass")
        )
      )
    )
    .orderBy(desc(engineerLearnings.createdAt))
    .limit(limit);

  if (rows.length === 0) return "";

  // Relevance score: prefer rows whose domain/taskType matches our keywords
  const scored = rows.map((row) => {
    let score = 0;
    const searchable = `${row.domain} ${row.taskType} ${row.mistake}`.toLowerCase();
    for (const kw of keywords) {
      if (searchable.includes(kw.toLowerCase())) score += 2;
    }
    // Prioritize recent mistakes
    if (row.verdict === "fail") score += 1;
    return { ...row, score };
  });

  // Sort by relevance, take top 10
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 10);

  // Format as context for the engineer prompt
  const lines = top.map((row) => {
    const header = row.verdict === "fail" ? "MISTAKE TO AVOID" : "GOOD PATTERN";
    return `[${header}] (${row.domain}, ${row.taskType})\n  Problem: ${row.mistake.slice(0, 300)}\n  Fix: ${row.correction.slice(0, 300)}`;
  });

  return lines.join("\n\n");
}

/**
 * Get learning stats for observability.
 */
export async function getLearningStats(): Promise<{
  total: number;
  byLanguage: Record<string, number>;
  byVerdict: Record<string, number>;
}> {
  const db = getDb();
  const rows = await db
    .select({
      language: engineerLearnings.language,
      verdict: engineerLearnings.verdict,
      count: sql<number>`count(*)::int`,
    })
    .from(engineerLearnings)
    .groupBy(engineerLearnings.language, engineerLearnings.verdict);

  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const byLanguage: Record<string, number> = {};
  const byVerdict: Record<string, number> = { pass: 0, fail: 0 };

  for (const row of rows) {
    byLanguage[row.language] = (byLanguage[row.language] || 0) + row.count;
    byVerdict[row.verdict] = (byVerdict[row.verdict] || 0) + row.count;
  }

  return { total, byLanguage, byVerdict };
}

/**
 * Extract meaningful domain keywords from a request string.
 */
function extractDomainKeywords(text: string): string[] {
  // Common programming domains/patterns to look for
  const domainPatterns = [
    /api/i, /rest/i, /graphql/i, /webhook/i, /scraper|scrape|parsing/i,
    /database|db|sql|postgres|mysql|mongo/i, /auth|login|oauth|jwt/i,
    /file|csv|json|excel|pdf/i, /email|notification|slack|discord/i,
    /test|testing|unit test/i, /docker|deploy|ci\/cd/i, /http|request|fetch/i,
    /automation|scheduled|cron/i, /data|analytics|chart|graph/i,
    /browser|selenium|puppeteer|playwright/i, /cli|command line/i,
    /image|resize|compress|convert/i, /search|filter|sort/i,
  ];

  const keywords: string[] = [];
  for (const pattern of domainPatterns) {
    if (pattern.test(text)) {
      keywords.push(text.match(pattern)?.[0] || "");
    }
  }

  // Also extract key nouns (2+ chars, not common stop words)
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const stopWords = new Set([
    "that", "this", "with", "from", "have", "will", "would", "could",
    "should", "write", "build", "make", "create", "need", "want",
    "please", "using", "used", "which", "their", "about", "into",
  ]);
  for (const w of words) {
    if (!stopWords.has(w)) keywords.push(w);
  }

  return [...new Set(keywords)].slice(0, 15);
}
