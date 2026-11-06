// Crawler policy for robots.txt (same policy as www.vyntexusa.com, lib/crawlers.ts there).
//
// Search and AI-search crawlers fetch pages to show, link and quote them in answers: allowed on the public pages.
// AI training crawlers collect pages to train models. They get exactly the same rules as the search crawlers: the
// public pages are open, the private addresses stay closed. Setting AI_TRAINING_CRAWLERS_ALLOWED to false closes the
// whole site to them again; that does not affect Google Search, AI Overviews, Bing, ChatGPT search, Perplexity or
// Claude answers, which use the search crawlers.
// Approved by management October 22, 2026.
export const AI_TRAINING_CRAWLERS_ALLOWED = true;

export const SEARCH_CRAWLERS = [
  'Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User',
  'Claude-SearchBot', 'Claude-User', 'Applebot', 'DuckDuckBot', 'MistralAI-User',
] as const;

export const AI_TRAINING_CRAWLERS = [
  'GPTBot', 'ClaudeBot', 'anthropic-ai', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider',
  'meta-externalagent', 'cohere-training-data-crawler',
] as const;
