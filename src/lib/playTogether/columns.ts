// Every games column the API is allowed to read. The host's payment
// details (host_phone, host_qr_path) are deliberately missing: they aren't
// granted to anon/authenticated, so `select("*")` on games fails. Players
// who've joined get them from game_host_payment_info() (security audit,
// DATABASE_ACCESS). A column added to games later must be granted in the
// database AND added here before the app can read it.
export const GAME_PUBLIC_COLUMNS =
  "id,host_id,court_booking_id,venue_id,court_id,sport,game_format,starts_at,ends_at,min_players,max_players," +
  "contribution_amount,service_fee,joining_deadline,notes,cancel_reason,status,created_at,updated_at,skill_level";
