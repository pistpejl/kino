const UNDERAGE_PATTERNS: RegExp[] = [
  /\b(child|children|kid|kids|toddler|infant|baby|babies)\b/i,
  /\b(minor|minors|underage|under[\s-]?age)\b/i,
  /\b(teen|teenager|teenagers|preteen|pre-teen)\b/i,
  /\b(girl|boy)\s+(aged?\s*)?(1[0-7]|[1-9])\b/i,
  /\b(aged?\s*)?(1[0-7]|[1-9])\s*(year|yr|y\.?o\.?)s?\s*old\b/i,
  /\b(loli|lolita|shota|shotacon|lolicon)\b/i,
  /\b(csam|cp|child\s*porn)\b/i,
  /\b(schoolgirl|schoolboy|elementary|middle[\s-]?school)\b/i,
  /\b(young\s*(girl|boy|child|kid))\b/i,
  /\b(pedo|paedo|pedophile|paedophile)\b/i,
];

export function containsUnderageContent(text: string): boolean {
  if (!text || !text.trim()) return false;
  return UNDERAGE_PATTERNS.some((re) => re.test(text));
}

export function safetyRejectMessage(): string {
  return "Blocked: content involving anyone under 18 is not allowed. KINO is for adults 21+ only.";
}
