import { createAccount } from "../features/accounts/accounts.js"
import { pool } from "../core/db.js"

// Admin pertama dibuat langsung ke database (PRD bagian 2, aturan role 4).
// Pemakaian: npm run seed:admin -- "Nama" email@contoh.com 08123456789
const [name, email, whatsapp] = process.argv.slice(2)
if (!name || !email || !whatsapp) {
  console.log('Pemakaian: npm run seed:admin -- "Nama" email@contoh.com 08123456789')
  process.exit(1)
}
const { user, temporary_password } = await createAccount(pool, { name, email, whatsapp }, "admin")
console.log(`Admin ${user.email} dibuat. Password sementara (wajib diganti saat masuk): ${temporary_password}`)
await pool.end()
