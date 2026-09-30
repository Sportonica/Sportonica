// Every tournament_teams column the API is allowed to read. The team's
// private contact details (club_address, contact_person_name,
// contact_phone, contact_email, manager_email) are deliberately missing:
// they aren't granted to anon/authenticated, so `select("*")` fails. The
// organizer, venue managers, super admins and the team itself get them from
// team_private_contacts() (security audit, DATABASE_ACCESS). Manager and
// coach names/phones stay public — they're shown on the public Teams tab.
// A column added to tournament_teams later must be granted in the database
// AND added here before the app can read it.
export const TEAM_PUBLIC_COLUMNS =
  "id,tournament_id,name,captain_id,ack_terms,status,created_at,seed,group_name,is_walkin,created_by," +
  "manager_name,manager_phone,logo_url,club_name,coach_name,coach_phone,category_id";

export const TEAM_PRIVATE_FIELDS = [
  "club_address", "contact_person_name", "contact_phone", "contact_email", "manager_email",
] as const;
