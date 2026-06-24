function isLowConfidenceAnswer(answer) {
  const normalized = answer
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return [
    /\b(i\s*['\s]?\s*)?(do\s*not|don't|dont)\s+know\b/,
    /\b(i\s*['\s]?\s*m|im|i\s+am)?\s*not\s+getting\b/,
    /\bnot\s+getting\s+it\b/,
    /\bno\s+idea\b/,
    /\bnot\s+sure\b/,
    /\bunsure\b/,
  ].some((pattern) => pattern.test(normalized));
}

const testCases = [
  "sorry i'don't know",
  "i don't know",
  "i dont know",
  "dont know",
  "don't know",
  "i do not know",
  "im not getting",
  "i'm not getting",
  "i am not getting",
  "not getting it",
  "no idea",
  "not sure",
  "i'm not sure",
  "unsure",
  "sorry i am unsure",
  "i know how to do that", // should be false
  "this is getting interesting", // should be false
  "i do not know how to do this but i think it is dfs", // should be true (includes 'i do not know')
];

for (const tc of testCases) {
  console.log(`"${tc}" => ${isLowConfidenceAnswer(tc)}`);
}
