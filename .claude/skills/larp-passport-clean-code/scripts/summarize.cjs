// Usage: node summarize.cjs eslint.json repoRoot
// Prints one line per violation, then a count per rule.
const [, , jsonPath, root] = process.argv
const norm = (p) => p.split('\\').join('/')
const base = norm(root) + '/'
const lines = []
const perRule = {}
for (const file of require(jsonPath)) {
  for (const m of file.messages) {
    const rule = m.ruleId ?? 'parse-error'
    perRule[rule] = (perRule[rule] ?? 0) + 1
    lines.push(`${norm(file.filePath).replace(base, '')}:${m.line}: [${rule}] ${m.message}`)
  }
}
console.log(lines.length ? lines.sort().join('\n') : 'none')
console.log(`total: ${lines.length}`, Object.keys(perRule).length ? JSON.stringify(perRule) : '')
