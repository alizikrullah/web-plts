import pg from "pg"

try { process.loadEnvFile() } catch { /* tanpa file .env, variabel diambil dari lingkungan server */ }

// bigint dan numeric dibaca sebagai number (rupiah aman sampai 9 x 10^15), date sebagai teks "YYYY-MM-DD"
// supaya tanggal kalender WIB tidak bergeser karena zona waktu.
pg.types.setTypeParser(20, Number)
pg.types.setTypeParser(1700, Number)
pg.types.setTypeParser(1082, v => v)

// Koneksi dibaca dari PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD.
export const connect = (database?: string) => new pg.Pool(database ? { database } : {})
export const pool = connect()

export type Db = pg.Pool | pg.PoolClient

// Jalankan beberapa query dalam satu transaksi.
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>) {
  const c = await pool.connect()
  try {
    await c.query("begin")
    const out = await fn(c)
    await c.query("commit")
    return out
  } catch (e) {
    await c.query("rollback")
    throw e
  } finally {
    c.release()
  }
}

export const one = async <T = any>(db: Db, sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T | undefined
export const all = async <T = any>(db: Db, sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[]
