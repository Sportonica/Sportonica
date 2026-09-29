// Every profiles column the API is allowed to read. `phone` is deliberately
// missing: it isn't granted to anon/authenticated (anyone could read every
// user's number), so `select("*")` on profiles fails. Your own phone comes
// from the get_my_profile() RPC; a game host gets players' phones from
// game_player_phones(). A column added to profiles later must be granted
// in the database AND added here before the app can read it.
//
// bio and city are also missing: a profile marked private (is_public =
// false) shouldn't hand them to anyone who asks. profile_about() returns
// them for public profiles, the owner and super admins (security audit,
// DATABASE_ACCESS).
export const PUBLIC_PROFILE_COLUMNS =
  "id,name,sports,trust_score,avatar_url,created_at,full_name,role,username,is_public,updated_at";
