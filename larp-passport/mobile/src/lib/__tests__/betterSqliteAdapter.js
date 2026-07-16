// Wraps better-sqlite3 in the async API shape of expo-sqlite's SQLiteDatabase
// so pingStore runs against real SQLite semantics in Jest (Node).
const Database = require('better-sqlite3')

function bind(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0]
  return params
}

export function openTestDb() {
  const db = new Database(':memory:')
  const adapter = {
    _raw: db,
    async execAsync(sql) {
      db.exec(sql)
    },
    async runAsync(sql, ...params) {
      const result = db.prepare(sql).run(...bind(params))
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowid }
    },
    async getAllAsync(sql, ...params) {
      return db.prepare(sql).all(...bind(params))
    },
    async getFirstAsync(sql, ...params) {
      return db.prepare(sql).get(...bind(params)) ?? null
    },
    // expo-sqlite hands the callback a txn handle with the same methods; a
    // manual BEGIN IMMEDIATE / COMMIT emulates that for async callbacks
    // (better-sqlite3's own .transaction() only supports sync functions).
    async withExclusiveTransactionAsync(task) {
      db.exec('begin immediate')
      try {
        await task(adapter)
        db.exec('commit')
      } catch (error) {
        db.exec('rollback')
        throw error
      }
    },
    close() {
      db.close()
    },
  }
  return adapter
}
