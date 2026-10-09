"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Trophy, Upload, X, Users, User, Handshake, MapPin } from "lucide-react";
import { SPORT_NAMES as SPORTS, normalizeSport, sportTeamSize } from "@/lib/sports";
import { saveScoringRules } from "@/lib/intelligence/actions";
import { CRICKET_TIEBREAKERS, TIEBREAKER_LABEL, cricketTableOf, type CricketTiebreaker } from "@/lib/intelligence/sports/cricketTable";
import { BASKETBALL_PRESETS, type BasketballPreset } from "@/lib/intelligence/sports/basketball/rules";
import { CRICKET_PRESETS, type CricketRules } from "@/lib/intelligence/sports/cricketRules";
import RuleFields from "@/components/intelligence/RuleFields";
import { createTournament, updateTournamentDraft, publishTournament, uploadTournamentBanner, uploadTournamentQr } from "@/lib/tournaments/actions";
import { parseMapsUrl } from "@/lib/admin/location";
import { isActionError } from "@/lib/actionError";
import { FORMAT_LABELS, TOURNAMENT_FORMATS, HOST_PAYMENT_METHODS, HOST_PAYMENT_METHOD_LABELS } from "@/lib/tournaments/types";
import type { Tournament, TournamentFormat, HostPaymentMethod } from "@/lib/tournaments/types";
import { shrinkImage, IMAGE_MAX } from "@/lib/images/shrink";
import Link from "next/link";
// its own field styles: the pages that show it do not all load them (the platform Settings tab did not)
import "@/app/platform/events/events.css";

const KTM_OFFSET = "+05:45";
const todayKTM = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kathmandu" });
const tomorrowKTM = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kathmandu" });
};
const toLocalDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const toLocalTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kathmandu" }) : "");
const combine = (date: string, time: string) => (date && time ? `${date}T${time}:00${KTM_OFFSET}` : "");

// the engine's cricket presets, with box-cricket overs for "custom"
const CRICKET_FORMATS = {
  t20: { overs: 20, perBowler: 4 },
  odi: { overs: 50, perBowler: 10 },
  test: { overs: null, perBowler: null },
  custom: { overs: 8, perBowler: 2 },
} as const;
const cricketPreset = (p: keyof typeof CRICKET_FORMATS): CricketRules =>
  ({ ...CRICKET_PRESETS[p], oversPerInnings: CRICKET_FORMATS[p].overs, maxOversPerBowler: CRICKET_FORMATS[p].perBowler });

export default function TournamentForm({
  venues, existing, mode = "venue", onSaved,
}: {
  venues: { id: string; name: string }[];
  existing?: Tournament;
  mode?: "venue" | "platform" | "organizer";
  // Editing a tournament that's already past draft (from Settings tab,
  // not the create/draft flow) — skip the redirect-on-save and publish
  // option, just report back so the caller can close the editor in place.
  onSaved?: (tournament: Tournament) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<"draft" | "published" | null>(null);
  const editingLive = !!existing && existing.status !== "draft";

  const [name, setName] = useState(existing?.name ?? "");
  const [sport, setSport] = useState(existing?.sport ?? "Futsal");
  const [venueId, setVenueId] = useState(existing?.venue_id ?? venues[0]?.id ?? "");
  // Organizer-only: their own ground (name + optional location pin) as an
  // alternative to picking a partnered Sportonica venue — no vendor
  // involved, so no partnership/booking-confirmation step for these.
  const [venueMode, setVenueMode] = useState<"partnered" | "own">(
    existing?.own_venue_name ? "own" : "partnered"
  );
  const [ownVenueName, setOwnVenueName] = useState(existing?.own_venue_name ?? "");
  const [ownVenueAddress, setOwnVenueAddress] = useState(existing?.own_venue_address ?? "");
  // Same pattern as a real venue's location (EditVenueForm.tsx /
  // src/lib/admin/location.ts) — paste a Google Maps link, parse it
  // server-side into lat/lng, rather than a browser-geolocation pin.
  const [ownVenueMapUrl, setOwnVenueMapUrl] = useState(existing?.own_venue_map_url ?? "");
  const [ownVenueLat, setOwnVenueLat] = useState<number | null>(existing?.own_venue_lat ?? null);
  const [ownVenueLng, setOwnVenueLng] = useState<number | null>(existing?.own_venue_lng ?? null);
  const [locBusy, setLocBusy] = useState(false);
  const [locErr, setLocErr] = useState<string | null>(null);
  const [organizerType, setOrganizerType] = useState<"venue" | "platform">(
    existing?.organizer_type ?? (mode === "platform" ? "platform" : "venue")
  );
  const [organizerName, setOrganizerName] = useState(existing?.organizer_name ?? "");
  const [bannerUrl, setBannerUrl] = useState(existing?.banner_url ?? "");
  const [bannerPreview, setBannerPreview] = useState<string | null>(existing?.banner_url ?? null);
  const [bannerUploading, setBannerUploading] = useState(false);
  const bannerFileRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [contactPhone, setContactPhone] = useState(existing?.contact_phone ?? "");

  // TBD: publish and open registration before the venue/date is locked
  // in. existing?.starts_at is only ever null for a tournament already
  // saved that way, so an explicit false default here (rather than
  // `!existing?.starts_at`) doesn't mistake "brand new form" for TBD.
  const [datesTbd, setDatesTbd] = useState(!!existing && existing.starts_at === null);
  const [startsDate, setStartsDate] = useState(toLocalDate(existing?.starts_at) || tomorrowKTM());
  const [startsTime, setStartsTime] = useState(toLocalTime(existing?.starts_at) || "09:00");
  const [endsDate, setEndsDate] = useState(toLocalDate(existing?.ends_at) || tomorrowKTM());
  const [endsTime, setEndsTime] = useState(toLocalTime(existing?.ends_at) || "18:00");
  const [regOpenDate, setRegOpenDate] = useState(toLocalDate(existing?.registration_opens_at) || todayKTM());
  const [regOpenTime, setRegOpenTime] = useState(toLocalTime(existing?.registration_opens_at) || "09:00");
  const [regCloseDate, setRegCloseDate] = useState(toLocalDate(existing?.registration_closes_at) || todayKTM());
  const [regCloseTime, setRegCloseTime] = useState(toLocalTime(existing?.registration_closes_at) || "18:00");
  const [matchMins, setMatchMins] = useState(existing?.match_duration_mins ?? 45);

  const [format, setFormat] = useState<TournamentFormat>(existing?.format ?? "knockout");
  const [maxTeams, setMaxTeams] = useState<number | null>(existing?.max_teams ?? 8);
  const [minPlayers, setMinPlayers] = useState(existing?.min_players_per_team ?? 5);
  const [maxPlayers, setMaxPlayers] = useState(existing?.max_players_per_team ?? 8);
  const [subLimit, setSubLimit] = useState(existing?.substitute_limit ?? 2);
  const [regMode, setRegMode] = useState<"team" | "individual">(existing?.registration_mode ?? "team");
  // Derived from format rather than a separate concept in the UI: the data
  // model's only individual-registration shape today is 'single_event'
  // (team-of-one, captain-only, no bracket) — e.g. a running race or a
  // singles chess/TT sign-up. Switching this also drives `format` and
  // `regMode` together so the rest of the form doesn't need to know about it.
  const [entryType, setEntryType] = useState<"team" | "individual">(
    existing?.format === "single_event" ? "individual" : "team"
  );
  function chooseEntryType(type: "team" | "individual") {
    setEntryType(type);
    setRegMode(type);
    if (type === "individual") {
      setFormat("single_event");
      // single_event repurposes this field as "Max players" — it must
      // stay a real number even if the team form left it unlimited.
      setMaxTeams((v) => v ?? 8);
    } else if (format === "single_event") setFormat("knockout");
  }
  const [genderRule, setGenderRule] = useState(existing?.gender_rule ?? "");
  const [skillCategory, setSkillCategory] = useState(existing?.skill_category ?? "");

  const [fee, setFee] = useState(existing?.fee ?? 0);
  const [paymentInstructions, setPaymentInstructions] = useState(existing?.payment_instructions ?? "");
  const [refundPolicy, setRefundPolicy] = useState(existing?.refund_policy ?? "");

  // The host's own payment QR — teams pay the host directly, and the host
  // verifies each payment from the Payments tab. Required once fee > 0.
  const [hostQrUrl, setHostQrUrl] = useState(existing?.host_payment_qr_url ?? "");
  const [hostQrPreview, setHostQrPreview] = useState<string | null>(existing?.host_payment_qr_url ?? null);
  const [hostQrUploading, setHostQrUploading] = useState(false);
  const hostQrFileRef = useRef<HTMLInputElement>(null);
  const [hostPayName, setHostPayName] = useState(existing?.host_payment_name ?? "");
  const [hostPayAccount, setHostPayAccount] = useState(existing?.host_payment_account ?? "");
  const [hostPayMethod, setHostPayMethod] = useState<HostPaymentMethod>(existing?.host_payment_method ?? "esewa");

  // Optional — leave at 0 to skip tracking cards/fines entirely for
  // sports/tournaments that don't use them.
  const [yellowCardFine, setYellowCardFine] = useState(existing?.yellow_card_fine ?? 0);
  const [redCardFine, setRedCardFine] = useState(existing?.red_card_fine ?? 0);
  // card fines are a futsal thing
  const cardSport = normalizeSport(sport) === "Futsal";
  // basketball: the game itself (saved as the tournament's scoring rules)
  const isBasketballSport = sport === "Basketball";
  const [bb, setBb] = useState(() => {
    const saved = (existing?.scoring_rules ?? {}) as Partial<typeof BASKETBALL_PRESETS.fiba>;
    const base = BASKETBALL_PRESETS[(saved.preset as BasketballPreset) in BASKETBALL_PRESETS ? (saved.preset as BasketballPreset) : "fiba"];
    return { ...base, ...saved };
  });
  const setPreset = (preset: string) => {
    if (!(preset in BASKETBALL_PRESETS)) return;
    const next = BASKETBALL_PRESETS[preset as BasketballPreset];
    setBb({ ...next });
    // a new tournament takes the format's team size too (3x3: 3 on court and 1 substitute)
    if (!existing) { setMinPlayers(next.playersOnCourt); setMaxPlayers(next.playersOnCourt); setSubLimit(next.gameRosterSize - next.playersOnCourt); }
  };
  // cricket: the format and overs (saved as the tournament's scoring rules)
  const isCricketSport = sport === "Cricket";
  const [ck, setCk] = useState(() => {
    const saved = (existing?.scoring_rules ?? {}) as Partial<CricketRules>;
    const preset = (saved.preset && saved.preset in CRICKET_FORMATS ? saved.preset : "t20") as keyof typeof CRICKET_FORMATS;
    return { ...cricketPreset(preset), ...saved, table: cricketTableOf(saved.table) };
  });
  // scoring rules are saved next to the tournament, once it exists
  async function saveGameRules(id: string): Promise<string | null> {
    if (!isBasketballSport && !isCricketSport) return null;
    // every rule, not just the ones on show: the server fills any missing one from the preset
    const res = await saveScoringRules(id, isBasketballSport ? bb : ck);
    return isActionError(res) ? `The tournament was saved, but the ${sport.toLowerCase()} settings were not: ${res.message}` : null;
  }

  const [prizeWinner, setPrizeWinner] = useState(existing?.prize_winner ?? "");
  const [prizeRunnerUp, setPrizeRunnerUp] = useState(existing?.prize_runner_up ?? "");
  const [prizeMvp, setPrizeMvp] = useState(existing?.prize_mvp ?? "");
  const [prizeOther, setPrizeOther] = useState(existing?.prize_other ?? "");

  const [rulesText, setRulesText] = useState(existing?.rules_text ?? "");
  const [equipmentNotes, setEquipmentNotes] = useState(existing?.equipment_notes ?? "");
  const [venueRules, setVenueRules] = useState(existing?.venue_rules ?? "");

  useEffect(() => {
    return () => { if (bannerPreview?.startsWith("blob:")) URL.revokeObjectURL(bannerPreview); };
  }, [bannerPreview]);

  useEffect(() => {
    return () => { if (hostQrPreview?.startsWith("blob:")) URL.revokeObjectURL(hostQrPreview); };
  }, [hostQrPreview]);

  function pickBannerFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const okTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!okTypes.includes(f.type)) { setErr("Upload a JPG, PNG or WebP image."); return; }
    setErr(null);
    if (bannerPreview?.startsWith("blob:")) URL.revokeObjectURL(bannerPreview);
    setBannerPreview(URL.createObjectURL(f));
    setBannerUploading(true);
    shrinkImage(f, { maxSize: IMAGE_MAX.banner })
      .then((small) => {
        if (small.size > 5 * 1024 * 1024) throw new Error("Image must be under 5 MB.");
        return uploadTournamentBanner(small);
      })
      .then((url) => {
        if (isActionError(url)) {
          if (url.message === "UNAUTHORIZED") {
            router.push(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
            return;
          }
          setErr(url.message);
          return;
        }
        setBannerUrl(url);
      })
      .catch((e2) => setErr(e2 instanceof Error ? e2.message : "Could not upload the banner image."))
      .finally(() => setBannerUploading(false));
  }

  function removeBanner() {
    if (bannerPreview?.startsWith("blob:")) URL.revokeObjectURL(bannerPreview);
    setBannerPreview(null);
    setBannerUrl("");
    if (bannerFileRef.current) bannerFileRef.current.value = "";
  }

  function pickHostQrFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const okTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!okTypes.includes(f.type)) { setErr("Upload a JPG, PNG or WebP QR image."); return; }
    if (f.size > 5 * 1024 * 1024) { setErr("QR image must be under 5 MB."); return; }
    setErr(null);
    if (hostQrPreview?.startsWith("blob:")) URL.revokeObjectURL(hostQrPreview);
    setHostQrPreview(URL.createObjectURL(f));
    setHostQrUploading(true);
    uploadTournamentQr(f)
      .then((url) => {
        if (isActionError(url)) {
          if (url.message === "UNAUTHORIZED") {
            router.push(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
            return;
          }
          setErr(url.message);
          return;
        }
        setHostQrUrl(url);
      })
      .catch((e2) => setErr(e2 instanceof Error ? e2.message : "Could not upload the QR image."))
      .finally(() => setHostQrUploading(false));
  }

  function removeHostQr() {
    if (hostQrPreview?.startsWith("blob:")) URL.revokeObjectURL(hostQrPreview);
    setHostQrPreview(null);
    setHostQrUrl("");
    if (hostQrFileRef.current) hostQrFileRef.current.value = "";
  }

  function captureLocation() {
    if (!ownVenueMapUrl.trim()) return;
    setLocBusy(true);
    setLocErr(null);
    parseMapsUrl(ownVenueMapUrl)
      .then((res) => {
        if (isActionError(res)) { setLocErr(res.message); return; }
        setOwnVenueLat(res.lat);
        setOwnVenueLng(res.lng);
        setOwnVenueMapUrl(res.url);
      })
      .catch((e) => setLocErr(e instanceof Error ? e.message : "Couldn't read that link."))
      .finally(() => setLocBusy(false));
  }

  function payload() {
    const isSingleEvent = format === "single_event";
    const useOwnVenue = (mode === "organizer" || mode === "platform") && venueMode === "own";
    return {
      venue_id: useOwnVenue ? undefined : venueId,
      own_venue_name: useOwnVenue ? ownVenueName.trim() : undefined,
      own_venue_address: useOwnVenue ? (ownVenueAddress.trim() || undefined) : undefined,
      own_venue_map_url: useOwnVenue ? (ownVenueMapUrl.trim() || undefined) : undefined,
      own_venue_lat: useOwnVenue ? (ownVenueLat ?? undefined) : undefined,
      own_venue_lng: useOwnVenue ? (ownVenueLng ?? undefined) : undefined,
      organizer_type: organizerType,
      organizer_name: organizerName.trim() || undefined,
      name: name.trim(),
      sport,
      banner_url: bannerUrl.trim() || undefined,
      description: description.trim() || undefined,
      contact_phone: contactPhone.trim() || undefined,
      starts_at: datesTbd ? null : combine(startsDate, startsTime),
      ends_at: datesTbd ? null : combine(endsDate, endsTime),
      registration_opens_at: combine(regOpenDate, regOpenTime),
      registration_closes_at: combine(regCloseDate, regCloseTime),
      match_duration_mins: matchMins,
      format,
      max_teams: maxTeams,
      min_players_per_team: isSingleEvent ? 1 : minPlayers,
      max_players_per_team: isSingleEvent ? 1 : maxPlayers,
      substitute_limit: isSingleEvent ? 0 : subLimit,
      registration_mode: regMode,
      gender_rule: genderRule.trim() || undefined,
      skill_category: skillCategory.trim() || undefined,
      fee,
      payment_instructions: paymentInstructions.trim() || undefined,
      refund_policy: refundPolicy.trim() || undefined,
      host_payment_qr_url: fee > 0 ? (hostQrUrl.trim() || undefined) : undefined,
      host_payment_name: fee > 0 ? (hostPayName.trim() || undefined) : undefined,
      host_payment_account: fee > 0 ? (hostPayAccount.trim() || undefined) : undefined,
      host_payment_method: fee > 0 ? hostPayMethod : undefined,
      yellow_card_fine: yellowCardFine,
      red_card_fine: redCardFine,
      prize_winner: prizeWinner.trim() || undefined,
      prize_runner_up: prizeRunnerUp.trim() || undefined,
      prize_mvp: prizeMvp.trim() || undefined,
      prize_other: prizeOther.trim() || undefined,
      rules_text: rulesText.trim() || undefined,
      equipment_notes: equipmentNotes.trim() || undefined,
      venue_rules: venueRules.trim() || undefined,
    };
  }

  function validate(): string | null {
    if (!name.trim()) return "Give the tournament a name.";
    if ((mode === "organizer" || mode === "platform") && venueMode === "own") {
      if (!ownVenueName.trim()) return "Give your venue a name.";
    } else if (!venueId) {
      return "Pick a venue.";
    }
    if (!datesTbd) {
      if (!startsDate) return "Set a start date.";
      if (!endsDate) return "Set an end date.";
    }
    if (!regOpenDate) return "Set when registration opens.";
    if (!regCloseDate) return "Set when registration closes.";
    if (!datesTbd && combine(endsDate, endsTime) <= combine(startsDate, startsTime)) return "End time must be after the start time.";
    if (!datesTbd && combine(regCloseDate, regCloseTime) > combine(startsDate, startsTime)) return "Registration must close before the tournament starts.";
    // A tournament that already ended (or whose registration window
    // already closed) before it's even published silently vanishes from
    // /tournaments and rejects every registration with "closed" — with no
    // hint anywhere why. Catching it here, at save time, is the only place
    // that can explain it clearly. Skipped for TBD dates — there's no end
    // time yet to check against. Also skipped once the tournament is
    // already live: by then a past registration-close (or even a past end
    // date, e.g. backdating after the fact) is a legitimate edit to an
    // event already running, not a mistake about to be published.
    if (!editingLive) {
      const nowIso = new Date().toISOString();
      if (!datesTbd && combine(endsDate, endsTime) <= nowIso) return "The tournament's end time has already passed. Pick a future date.";
      if (combine(regCloseDate, regCloseTime) <= nowIso) return "Registration closes in the past. Pick a future date/time.";
    }
    if (format !== "single_event" && maxPlayers < minPlayers) return "Max players per team can't be less than the minimum.";
    // A paid tournament with no QR is a foot-gun: the payer checkout would
    // render an empty QR panel with no support fallback, since the host —
    // not Sportonica — owns this payment. Server re-checks at publish and
    // pay time; this just catches it early. Free tournaments are exempt.
    if (fee > 0 && !hostQrUrl.trim()) return "Upload your payment QR. Teams pay you directly, so a paid tournament needs one.";
    if (fee > 0 && !hostPayName.trim()) return "Enter the name your payment QR pays to.";
    return null;
  }

  const detailHref = (id: string) =>
    mode === "platform" ? `/platform/tournaments/${id}`
    : mode === "organizer" ? `/organize/tournaments/${id}`
    : `/admin/tournaments/${id}`;

  function saveDraft() {
    const v = validate();
    if (v) { setErr(v); return; }
    setErr(null);
    startTransition(async () => {
      const result = existing
        ? await updateTournamentDraft(existing.id, payload())
        : await createTournament(payload());
      if (isActionError(result)) { setErr(result.message); return; }
      const rulesErr = await saveGameRules(result.id);
      if (rulesErr) { setErr(rulesErr); return; }
      if (onSaved) { onSaved(result); return; }
      setDone("draft");
      setTimeout(() => router.push(detailHref(result.id)), 900);
    });
  }

  function saveAndPublish() {
    const v = validate();
    if (v) { setErr(v); return; }
    setErr(null);
    startTransition(async () => {
      const saved = existing
        ? await updateTournamentDraft(existing.id, payload())
        : await createTournament(payload());
      if (isActionError(saved)) { setErr(saved.message); return; }
      const rulesErr = await saveGameRules(saved.id);
      if (rulesErr) { setErr(rulesErr); return; }
      const published = await publishTournament(saved.id);
      if (isActionError(published)) { setErr(published.message); return; }
      setDone("published");
      setTimeout(() => router.push(detailHref(saved.id)), 900);
    });
  }

  if (done) {
    return (
      <div className="ev-card" style={{ textAlign: "center", padding: 40 }}>
        <Check size={30} style={{ color: "#2E7D5B", marginBottom: 12 }} />
        <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 22, fontWeight: 800 }}>
          {done === "published" ? "Sent for review" : "Draft saved"}
        </div>
        <div style={{ opacity: 0.6, fontSize: 13.5, marginTop: 6 }}>
          {done === "published"
            ? "Sportonica will review and publish it shortly."
            : "You can keep editing before publishing."}
        </div>
      </div>
    );
  }

  return (
    <div className="ev-card" style={{ maxWidth: 640 }}>
      <SectionTitle>Basic info</SectionTitle>
      <div className="ev-field">
        <label>Tournament name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kathmandu Futsal Cup 2026" />
      </div>
      {editingLive && (
        <p style={{ fontSize: 12.5, opacity: 0.6, margin: "-8px 0 4px" }}>
          Venue can&apos;t be changed here. {existing?.own_venue_name || venues.find((v) => v.id === existing?.venue_id)?.name || "current venue"} stays fixed for this tournament.
        </p>
      )}
      <div className="ev-row">
        <div className="ev-field">
          <label>Sport</label>
          <select value={sport} onChange={(e) => {
            const next = e.target.value;
            setSport(next);
            // a new tournament starts from the sport's own team size (basketball: 5 + 7 substitutes)
            const size = sportTeamSize(next);
            if (size && !existing) { setMinPlayers(size.onCourt); setMaxPlayers(size.onCourt); setSubLimit(size.substitutes); }
          }}>
            {SPORTS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        {mode === "venue" && !editingLive && (
          <div className="ev-field">
            <label>Venue</label>
            <select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        )}
      </div>
      {(mode === "organizer" || mode === "platform") && !editingLive && (
        <div className="ev-field">
          <label>Venue</label>
          <div className="ev-entry-toggle">
            <button type="button" className={venueMode === "partnered" ? "on" : ""} onClick={() => setVenueMode("partnered")}>
              <Handshake size={15} />
              <span>
                {mode === "platform" ? "Sportonica venue" : "Partnered venue"}
                <small>{mode === "platform" ? "Pick from any venue listed on the platform" : "Pick from venues that have accepted your invite"}</small>
              </span>
            </button>
            <button type="button" className={venueMode === "own" ? "on" : ""} onClick={() => setVenueMode("own")}>
              <MapPin size={15} />
              <span>{mode === "platform" ? "Unlisted venue" : "My own venue"}<small>Name and location only, no vendor involved</small></span>
            </button>
          </div>
          {venueMode === "partnered" ? (
            venues.length === 0 ? (
              <p style={{ fontSize: 12.5, opacity: 0.7, marginTop: 10 }}>
                {mode === "platform" ? (
                  <>No venues listed on the platform yet. Switch to &quot;Unlisted venue&quot; above, or add one under Venues first.</>
                ) : (
                  <>No partnered venues yet. <Link href="/organize/partnerships" style={{ color: "#006241" }}>Invite one</Link>, or switch to &quot;My own venue&quot; above.</>
                )}
              </p>
            ) : (
              <select value={venueId} onChange={(e) => setVenueId(e.target.value)} style={{ marginTop: 10 }}>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              <input value={ownVenueName} onChange={(e) => setOwnVenueName(e.target.value)} placeholder="Venue name" />
              <input value={ownVenueAddress} onChange={(e) => setOwnVenueAddress(e.target.value)} placeholder="Address (optional)" />
              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, opacity: 0.7, marginBottom: 7 }}>
                  Location link (optional)
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={ownVenueMapUrl} onChange={(e) => setOwnVenueMapUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), captureLocation())}
                    placeholder="https://maps.app.goo.gl/…  or  https://www.google.com/maps/…"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button" className="ev-btn" disabled={locBusy || !ownVenueMapUrl.trim()}
                    style={{ background: "transparent", color: "inherit", border: "1px solid rgba(128,128,128,0.35)", whiteSpace: "nowrap" }}
                    onClick={captureLocation}
                  >
                    {locBusy ? "Reading…" : "Capture"}
                  </button>
                </div>
                <p style={{ fontSize: 11.5, opacity: 0.6, marginTop: 6 }}>
                  On Google Maps, find your venue → tap Share → Copy link → paste it here.
                </p>
                {locErr && <div className="ev-err" style={{ marginTop: 8 }}>{locErr}</div>}
                {ownVenueLat != null && !locErr && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#006241", fontWeight: 600, marginTop: 8 }}>
                    <MapPin size={13} /> Location captured <Check size={13} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {mode === "platform" && (
        <div className="ev-row">
          <div className="ev-field">
            <label>Organizer</label>
            <select value={organizerType} onChange={(e) => setOrganizerType(e.target.value as "venue" | "platform")}>
              <option value="platform">Sportonica (platform-run)</option>
              <option value="venue">The venue itself</option>
            </select>
          </div>
          <div className="ev-field">
            <label>Organizer name{organizerType === "platform" ? "" : " (optional)"}</label>
            <input value={organizerName} onChange={(e) => setOrganizerName(e.target.value)} placeholder="Sportonica" />
          </div>
        </div>
      )}
      {mode === "organizer" && (
        <div className="ev-field">
          <label>Organizer name (optional)</label>
          <input value={organizerName} onChange={(e) => setOrganizerName(e.target.value)} placeholder="Shown publicly as who's running this" />
        </div>
      )}
      <div className="ev-field">
        <label>Banner image (optional)</label>
        <input
          ref={bannerFileRef} type="file" accept="image/jpeg,image/png,image/webp"
          onChange={pickBannerFile} style={{ display: "none" }}
        />
        {bannerPreview ? (
          <div className="tf-banner-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bannerPreview} alt="" />
            <button type="button" className="tf-banner-replace" onClick={() => bannerFileRef.current?.click()}>
              {bannerUploading ? "Uploading…" : "Replace"}
            </button>
            <button type="button" className="tf-banner-remove" onClick={removeBanner} aria-label="Remove banner image">
              <X size={13} />
            </button>
          </div>
        ) : (
          <button type="button" className="tf-banner-upload" onClick={() => bannerFileRef.current?.click()}>
            <Upload size={15} /> Upload from your computer
          </button>
        )}
        <style>{`
          .tf-banner-preview{position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--line, rgba(128,128,128,.3));max-height:180px}
          .tf-banner-preview img{width:100%;max-height:180px;object-fit:cover;display:block;background:rgba(128,128,128,.1)}
          .tf-banner-replace{position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,.7);color:#fff;font-size:11px;font-weight:700;padding:5px 10px;border-radius:999px;border:none;cursor:pointer;font-family:inherit}
          .tf-banner-remove{position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,.7);color:#fff;border:none;cursor:pointer;display:grid;place-items:center}
          .tf-banner-upload{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:13px;min-height:44px;box-sizing:border-box;border-radius:11px;border:1px dashed var(--line, rgba(128,128,128,.4));background:transparent;color:inherit;font-family:inherit;font-size:13.5px;font-weight:700;cursor:pointer}
        `}</style>
      </div>
      <div className="ev-field">
        <label>Description</label>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's this tournament about?" />
      </div>
      <div className="ev-field">
        <label>Contact phone (shown to registered captains)</label>
        <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="98XXXXXXXX" />
      </div>

      <SectionTitle>Schedule</SectionTitle>
      <label className="ev-check">
        <input type="checkbox" checked={datesTbd} onChange={(e) => setDatesTbd(e.target.checked)} />
        <span>Date TBD: venue/date not locked in yet, decide later</span>
      </label>
      {!datesTbd && (
        <>
          <div className="ev-row">
            <div className="ev-field">
              <label>Starts</label>
              <input type="date" value={startsDate} onChange={(e) => setStartsDate(e.target.value)} />
            </div>
            <div className="ev-field">
              <label>Start time</label>
              <input type="time" value={startsTime} onChange={(e) => setStartsTime(e.target.value)} />
            </div>
          </div>
          <div className="ev-row">
            <div className="ev-field">
              <label>Ends</label>
              <input type="date" value={endsDate} onChange={(e) => setEndsDate(e.target.value)} />
            </div>
            <div className="ev-field">
              <label>End time</label>
              <input type="time" value={endsTime} onChange={(e) => setEndsTime(e.target.value)} />
            </div>
          </div>
        </>
      )}
      <div className="ev-row">
        <div className="ev-field">
          <label>Registration opens</label>
          <input type="date" value={regOpenDate} onChange={(e) => setRegOpenDate(e.target.value)} />
        </div>
        <div className="ev-field">
          <label>Time</label>
          <input type="time" value={regOpenTime} onChange={(e) => setRegOpenTime(e.target.value)} />
        </div>
      </div>
      <div className="ev-row">
        <div className="ev-field">
          <label>Registration closes</label>
          <input type="date" value={regCloseDate} onChange={(e) => setRegCloseDate(e.target.value)} />
        </div>
        <div className="ev-field">
          <label>Time</label>
          <input type="time" value={regCloseTime} onChange={(e) => setRegCloseTime(e.target.value)} />
        </div>
      </div>
      <div className="ev-field">
        <label>Match duration (minutes)</label>
        <input type="number" min={10} value={matchMins} onChange={(e) => setMatchMins(Number(e.target.value))} />
      </div>

      <SectionTitle>Format & teams</SectionTitle>
      <div className="ev-field">
        <label>Registration type</label>
        <div className="ev-entry-toggle">
          <button type="button" className={entryType === "team" ? "on" : ""} onClick={() => chooseEntryType("team")}>
            <Users size={15} />
            <span>Team<small>Multiple players per entry: futsal, cricket…</small></span>
          </button>
          <button type="button" className={entryType === "individual" ? "on" : ""} onClick={() => chooseEntryType("individual")}>
            <User size={15} />
            <span>Individual<small>One person per entry: running, singles chess…</small></span>
          </button>
        </div>
        <style>{`
          .ev-entry-toggle { display: flex; gap: 10px; flex-wrap: wrap; }
          .ev-entry-toggle button {
            flex: 1 1 220px; display: flex; align-items: flex-start; gap: 9px; text-align: left;
            padding: 12px 14px; border-radius: 11px; border: 1px solid rgba(128,128,128,0.3);
            background: transparent; color: inherit; font-family: inherit; cursor: pointer;
          }
          .ev-entry-toggle button.on { border-color: #006241; background: rgba(0,98,65,0.1); }
          .ev-entry-toggle button svg { flex-shrink: 0; margin-top: 2px; color: #006241; }
          .ev-entry-toggle button span { display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; font-weight: 700; }
          .ev-entry-toggle button small { font-size: 11.5px; font-weight: 500; opacity: 0.65; }
        `}</style>
      </div>
      {entryType === "team" && (
        <div className="ev-field">
          <label>Format</label>
          <select value={format} onChange={(e) => setFormat(e.target.value as TournamentFormat)}>
            {TOURNAMENT_FORMATS.filter((f) => f !== "single_event").map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
          </select>
        </div>
      )}
      <div className="ev-row">
        <div className="ev-field">
          <label>{format === "single_event" ? "Max players" : "Max teams"}</label>
          <input
            type="number"
            min={format === "single_event" ? 1 : 2}
            value={maxTeams ?? ""}
            disabled={maxTeams === null}
            onChange={(e) => setMaxTeams(Number(e.target.value))}
          />
          {format !== "single_event" && (
            <label className="ev-check">
              <input
                type="checkbox"
                checked={maxTeams === null}
                onChange={(e) => setMaxTeams(e.target.checked ? null : 8)}
              />
              <span>No limit on number of teams</span>
            </label>
          )}
        </div>
        {format !== "single_event" && (
          <div className="ev-field">
            <label>Substitute slots per team</label>
            <input type="number" min={0} value={subLimit} onChange={(e) => setSubLimit(Number(e.target.value))} />
          </div>
        )}
      </div>
      {format !== "single_event" && (
        <div className="ev-row">
          <div className="ev-field">
            <label>Min players per team</label>
            <input type="number" min={1} value={minPlayers} onChange={(e) => setMinPlayers(Number(e.target.value))} />
          </div>
          <div className="ev-field">
            <label>Max players per team</label>
            <input type="number" min={1} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} />
          </div>
        </div>
      )}
      {format !== "single_event" && (
        <p className="tc-dim" style={{ fontSize: 12.5, margin: "-4px 0 12px" }}>
          Each team can register up to {maxPlayers + subLimit} people: {maxPlayers} player{maxPlayers === 1 ? "" : "s"} and {subLimit} substitute{subLimit === 1 ? "" : "s"}.
          {sportTeamSize(sport) ? ` ${sport} standard: ${sportTeamSize(sport)!.onCourt} on court and ${sportTeamSize(sport)!.substitutes} substitutes (${sportTeamSize(sport)!.onCourt + sportTeamSize(sport)!.substitutes} in total).` : ""}
        </p>
      )}
      <div className="ev-row">
        <div className="ev-field">
          <label>Gender rule (optional)</label>
          <input list="tf-gender" value={genderRule} onChange={(e) => setGenderRule(e.target.value)} placeholder="Men, Women, Mixed, Open…" />
          <datalist id="tf-gender">
            <option value="Men" /><option value="Women" /><option value="Mixed" /><option value="Open" />
          </datalist>
        </div>
        <div className="ev-field">
          <label>Skill category (optional)</label>
          <input value={skillCategory} onChange={(e) => setSkillCategory(e.target.value)} placeholder="Open, Amateur, Pro…" />
        </div>
      </div>

      {isBasketballSport && (
        <>
          <SectionTitle>Basketball game</SectionTitle>
          <RuleFields sport="basketball" look="console" rules={bb as unknown as Record<string, unknown>}
            onChange={(r) => setBb(r as unknown as typeof bb)} onPreset={setPreset} />
          <p className="tc-dim" style={{ fontSize: 12.5, margin: "-4px 0 12px" }}>
            Matches already being scored keep the rules they started with. Change one match&apos;s rules from its scorer.
          </p>
        </>
      )}

      {isCricketSport && (
        <>
          <SectionTitle>Cricket game</SectionTitle>
          <RuleFields sport="cricket" look="console" rules={ck as unknown as Record<string, unknown>}
            onChange={(r) => setCk({ ...(r as unknown as CricketRules), table: ck.table })}
            onPreset={(p) => { if (p in CRICKET_FORMATS) setCk({ ...cricketPreset(p as keyof typeof CRICKET_FORMATS), table: ck.table }); }} />
          <p className="tc-dim" style={{ fontSize: 12.5, margin: "-4px 0 12px" }}>
            Matches already being scored keep the rules they started with. Change one match&apos;s rules from its scorer.
          </p>
          {format !== "knockout" && (
            <>
              <SectionTitle>Points table</SectionTitle>
              <div className="ev-row">
                {([["win", "Win"], ["tie", "Tie"], ["noResult", "No result"], ["loss", "Loss"]] as const).map(([k, label]) => (
                  <div className="ev-field" key={k}>
                    <label>{label} (points)</label>
                    <input type="number" min={0} max={20} value={ck.table[k]}
                      onChange={(e) => setCk({ ...ck, table: { ...ck.table, [k]: Math.min(20, Math.max(0, Math.round(Number(e.target.value) || 0))) } })} />
                  </div>
                ))}
              </div>
              <div className="ev-row">
                {[0, 1].map((i) => (
                  <div className="ev-field" key={i}>
                    <label>{i === 0 ? "Level on points: first" : "Then"}</label>
                    <select value={ck.table.tiebreakers[i] ?? ""} onChange={(e) => {
                      const tb = [...ck.table.tiebreakers];
                      if (e.target.value) tb[i] = e.target.value as CricketTiebreaker; else tb.splice(i);
                      setCk({ ...ck, table: { ...ck.table, tiebreakers: [...new Set(tb.filter(Boolean))] } });
                    }}>
                      {i === 1 ? <option value="">Nothing else</option> : null}
                      {CRICKET_TIEBREAKERS.filter((x) => i === 0 || x !== ck.table.tiebreakers[0]).map((x) => <option key={x} value={x}>{TIEBREAKER_LABEL[x].charAt(0).toUpperCase() + TIEBREAKER_LABEL[x].slice(1)}</option>)}
                    </select>
                  </div>
                ))}
                <div className="ev-field">
                  <label>Teams going through{format === "group_knockout" ? " (each group)" : ""}</label>
                  <input type="number" min={1} value={ck.table.qualifiers ?? ""} placeholder="Not set"
                    onChange={(e) => setCk({ ...ck, table: { ...ck.table, qualifiers: e.target.value.trim() === "" ? null : Math.max(1, Math.round(Number(e.target.value) || 1)) } })} />
                </div>
              </div>
              <div className="ev-row">
                <label className="ev-check" style={{ alignSelf: "center" }}>
                  <input type="checkbox" checked={ck.table.bonusRatio !== null}
                    onChange={(e) => setCk({ ...ck, table: { ...ck.table, bonusRatio: e.target.checked ? 1.25 : null } })} />
                  Bonus point for a convincing win
                </label>
                {ck.table.bonusRatio !== null && (
                  <div className="ev-field">
                    <label>Winner&apos;s run rate at least (× the loser&apos;s)</label>
                    <input type="number" min={1} max={3} step={0.05} value={ck.table.bonusRatio}
                      onChange={(e) => setCk({ ...ck, table: { ...ck.table, bonusRatio: Math.min(3, Math.max(1, Number(e.target.value) || 1.25)) } })} />
                  </div>
                )}
              </div>
              <p className="tc-dim" style={{ fontSize: 12.5, margin: "-4px 0 12px" }}>
                {ck.table.win <= ck.table.loss ? "A win must be worth more than a loss. " : ""}
                With teams going through set, the table marks each team Qualified, In contention or Eliminated, but only once it is mathematically certain.
              </p>
            </>
          )}
        </>
      )}

      <SectionTitle>Registration & payment</SectionTitle>
      <div className="ev-field">
        <label>Registration fee per team (Rs, enter 0 for free)</label>
        <input type="number" min={0} value={fee} onChange={(e) => setFee(Number(e.target.value))} />
      </div>
      {fee > 0 && (
        <>
          <div className="ev-field">
            <label>Your payment QR</label>
            <input
              ref={hostQrFileRef} type="file" accept="image/jpeg,image/png,image/webp"
              onChange={pickHostQrFile} style={{ display: "none" }}
            />
            {hostQrPreview ? (
              <div className="tf-banner-preview" style={{ maxHeight: 220 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={hostQrPreview} alt="" style={{ maxHeight: 220, objectFit: "contain", background: "#fff" }} />
                <button type="button" className="tf-banner-replace" onClick={() => hostQrFileRef.current?.click()}>
                  {hostQrUploading ? "Uploading…" : "Replace"}
                </button>
                <button type="button" className="tf-banner-remove" onClick={removeHostQr} aria-label="Remove QR image">
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button type="button" className="tf-banner-upload" onClick={() => hostQrFileRef.current?.click()}>
                <Upload size={15} /> {hostQrUploading ? "Uploading…" : "Upload your eSewa / Khalti QR"}
              </button>
            )}
            <p style={{ fontSize: 11.5, opacity: 0.6, marginTop: 6 }}>
              Teams scan this to pay you directly. Sportonica never holds this money. You verify each
              payment yourself in the Payments tab.
            </p>
          </div>
          <div className="ev-row">
            <div className="ev-field">
              <label>Payment method</label>
              <select value={hostPayMethod} onChange={(e) => setHostPayMethod(e.target.value as HostPaymentMethod)}>
                {HOST_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{HOST_PAYMENT_METHOD_LABELS[m]}</option>)}
              </select>
            </div>
            <div className="ev-field">
              <label>Name it pays to</label>
              <input value={hostPayName} onChange={(e) => setHostPayName(e.target.value)} placeholder="Shown to teams paying you" />
            </div>
          </div>
          <div className="ev-field">
            <label>Account / ID (optional)</label>
            <input value={hostPayAccount} onChange={(e) => setHostPayAccount(e.target.value)} placeholder="eSewa/Khalti number or bank account" />
          </div>
        </>
      )}
      <div className="ev-field">
        <label>Payment instructions (optional)</label>
        <textarea rows={2} value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} placeholder="Any extra instructions shown at checkout." />
      </div>
      <div className="ev-field">
        <label>Refund policy (optional)</label>
        <textarea rows={2} value={refundPolicy} onChange={(e) => setRefundPolicy(e.target.value)} />
      </div>

      <SectionTitle>Prizes (optional)</SectionTitle>
      <div className="ev-row">
        <div className="ev-field">
          <label>Winner</label>
          <input value={prizeWinner} onChange={(e) => setPrizeWinner(e.target.value)} placeholder="Rs 50,000" />
        </div>
        <div className="ev-field">
          <label>Runner-up</label>
          <input value={prizeRunnerUp} onChange={(e) => setPrizeRunnerUp(e.target.value)} placeholder="Rs 20,000" />
        </div>
      </div>
      <div className="ev-row">
        <div className="ev-field">
          <label>Best Player</label>
          <input value={prizeMvp} onChange={(e) => setPrizeMvp(e.target.value)} />
        </div>
        <div className="ev-field">
          <label>Other</label>
          <input value={prizeOther} onChange={(e) => setPrizeOther(e.target.value)} />
        </div>
      </div>

      <SectionTitle>Rules (optional)</SectionTitle>
      <div className="ev-field">
        <label>Tournament rules</label>
        <textarea rows={3} value={rulesText} onChange={(e) => setRulesText(e.target.value)} placeholder="Paste your full rules & regulations here. Shown to every registered team." />
      </div>
      {cardSport && <div className="ev-row">
        <div className="ev-field">
          <label>Yellow card fine (Rs)</label>
          <input type="number" min={0} value={yellowCardFine} onChange={(e) => setYellowCardFine(Number(e.target.value))} placeholder="0 = not tracked" />
        </div>
        <div className="ev-field">
          <label>Red card fine (Rs)</label>
          <input type="number" min={0} value={redCardFine} onChange={(e) => setRedCardFine(Number(e.target.value))} placeholder="0 = not tracked" />
        </div>
      </div>}
      <div className="ev-field">
        <label>Equipment notes</label>
        <textarea rows={2} value={equipmentNotes} onChange={(e) => setEquipmentNotes(e.target.value)} />
      </div>
      <div className="ev-field">
        <label>Venue rules</label>
        <textarea rows={2} value={venueRules} onChange={(e) => setVenueRules(e.target.value)} />
      </div>

      {err && <div className="ev-err">{err}</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {onSaved ? (
          <button className="ev-btn" onClick={saveDraft} disabled={pending}>
            <Check size={15} /> {pending ? "Saving…" : "Save changes"}
          </button>
        ) : (
          <>
            <button className="ev-btn" style={{ background: "transparent", color: "inherit", border: "1px solid rgba(128,128,128,0.35)" }} onClick={saveDraft} disabled={pending}>
              {pending ? "Saving…" : "Save draft"}
            </button>
            <button className="ev-btn" onClick={saveAndPublish} disabled={pending}>
              <Trophy size={15} /> {pending ? "Submitting…" : "Save & submit for review"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", opacity: 0.5, margin: "22px 0 12px" }}>
      {children}
    </div>
  );
}
