const stopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for",
  "from", "give", "how", "i", "in", "is", "it", "me", "of", "on", "or", "the",
  "their", "this", "to", "use", "using", "what", "when", "with", "would", "you",
]);

function tokenizeForScoring(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function fastCheckNonTechnicalAnswer(candidateAnswer) {
  const clean = candidateAnswer.trim();
  const tokens = tokenizeForScoring(clean);
  console.log(`Input: "${candidateAnswer}" => Tokens: ${JSON.stringify(tokens)} (Count: ${tokens.length})`);
  return tokens.length < 2;
}

const testCases = [
  ".",
  "ok",
  "hi",
  "hello",
  "yes",
  "no",
  "I am Arman",
  "I am a Software Engineer",
  "React Node.js Express CSS",
  "built using React",
];

for (const tc of testCases) {
  const isIrrelevant = fastCheckNonTechnicalAnswer(tc);
  console.log(`Is Irrelevant (Fast Check): ${isIrrelevant}`);
  console.log("-------------------");
}
