// Usage: node cpd-summary.cjs jscpd-report.json
// Prints one line per duplicated block, largest first, then the totals.
const fs = require('fs')
const [, , reportPath] = process.argv
if (!fs.existsSync(reportPath)) {
  console.log('none (jscpd wrote no report)')
  process.exit(0)
}
const { duplicates, statistics } = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const short = (p) => p.split('\\').join('/').replace('larp-passport/mobile/src/', 'm/').replace('larp-dashboard/src/', 'd/')
const at = (f) => `${short(f.name)}:${f.start}-${f.end}`
const lines = duplicates
  .sort((a, b) => b.lines - a.lines)
  .map((d) => `${d.lines}L ${at(d.firstFile)} <-> ${at(d.secondFile)}`)
console.log(lines.length ? lines.join('\n') : 'none')
console.log(`total: ${statistics.total.duplicatedLines} duplicated lines (${statistics.total.percentage}%)`)
