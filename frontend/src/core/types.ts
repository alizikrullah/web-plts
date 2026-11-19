// Ringkasan proyek dari backend, dipakai Home client dan halaman client.
export interface ProjectSummary {
  id: string; code: string; name: string; address: string; city: string; estimated_finish_date: string | null
  submitted_at: string | null; accepted_at: string | null; finished_at: string | null; rejected_reason: string | null
  status_key: string; status_name: string; sub_status_name: string | null
  last_update: { note: string | null; at: string } | null
  pic: { name: string; whatsapp: string } | null
  initial_invoice: { number: string; status: string; total: number; due_date: string; price_valid_until: string | null } | null
  purchases: { count: number; total_paid: number; last_date: string | null }
  simulation: { capacity_kwp: number; panel_qty: number; daily_production_kwh: number; monthly_saving: number; bep_years: number | null; est_investment: number } | null
  stages: { status_key: string; name: string; entered_at: string | null }[]
}

export interface PublicSettings { settings: Record<string, any>; faqs: { id: string; question: string; answer: string }[] }
