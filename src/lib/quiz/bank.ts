import "server-only";
import { createHmac } from "crypto";
import { QUIZ, type PlayerQuestion } from "./quiz";

// The question bank, with answers: 35 easy, 25 medium, 15 hard. Server only: a phone receives just
// its own four questions (pickQuestions), never this list.
//
// Each player's questions come from their phone number (seeded, with a
// server secret), so scoring can work out again which four they had
// without storing anything before they finish, and nobody can choose
// their questions by sending different ids.

type Level = "easy" | "medium" | "hard";
interface BankQuestion { id: string; level: Level; text: string; options: string[]; answer: number }

export const BANK: BankQuestion[] = [
  // ── easy ──
  { id: "soccer-players", level: "easy", text: "How many players from one team are on the field in a standard football (soccer) match?", options: ["9", "11", "7", "12"], answer: 1 },
  { id: "wc-2022", level: "easy", text: "Who won the 2022 FIFA World Cup in Qatar?", options: ["France", "Argentina", "Croatia", "Brazil"], answer: 1 },
  { id: "match-length", level: "easy", text: "How long is a standard football match, not counting stoppage time?", options: ["60 minutes", "80 minutes", "90 minutes", "120 minutes"], answer: 2 },
  { id: "red-card", level: "easy", text: "What colour card sends a football player off the field?", options: ["Yellow", "Red", "Blue", "Green"], answer: 1 },
  { id: "over-balls", level: "easy", text: "How many legal balls are in a standard over in cricket?", options: ["5", "6", "8", "10"], answer: 1 },
  { id: "lbw", level: "easy", text: "In cricket, what does LBW stand for?", options: ["Long Ball Wide", "Leg Before Wicket", "Left Bat Wicket", "Last Ball Won"], answer: 1 },
  { id: "god-of-cricket", level: "easy", text: "Which player is known as the \"God of Cricket\"?", options: ["Virat Kohli", "Sachin Tendulkar", "MS Dhoni", "Brian Lara"], answer: 1 },
  { id: "cricket-players", level: "easy", text: "How many players does a cricket team have on the field?", options: ["9", "10", "11", "12"], answer: 2 },
  { id: "three-pointer", level: "easy", text: "How many points is a shot from behind the three-point line in basketball?", options: ["2", "3", "4", "1"], answer: 1 },
  { id: "basketball-players", level: "easy", text: "How many players per team are on the court in basketball?", options: ["4", "5", "6", "7"], answer: 1 },
  { id: "shuttlecock", level: "easy", text: "Which sport uses a shuttlecock?", options: ["Squash", "Table tennis", "Badminton", "Tennis"], answer: 2 },
  { id: "usain-bolt", level: "easy", text: "Usain Bolt is most famous for which event?", options: ["Long jump", "100 m sprint", "Marathon", "Hurdles"], answer: 1 },
  { id: "most-world-cups", level: "easy", text: "Which country has won the most FIFA World Cups?", options: ["Germany", "Italy", "Brazil", "Argentina"], answer: 2 },
  { id: "puck", level: "easy", text: "Which sport is played with a puck?", options: ["Field hockey", "Ice hockey", "Polo", "Lacrosse"], answer: 1 },
  { id: "olympic-rings", level: "easy", text: "How many rings are on the Olympic flag?", options: ["4", "5", "6", "7"], answer: 1 },
  { id: "wimbledon-sport", level: "easy", text: "Which sport is played at Wimbledon?", options: ["Golf", "Cricket", "Tennis", "Badminton"], answer: 2 },
  { id: "league-win-points", level: "easy", text: "In a football league table, how many points does a team get for a win?", options: ["1", "2", "3", "4"], answer: 2 },
  { id: "hat-trick", level: "easy", text: "What is it called when one player scores three goals in a match?", options: ["Hat-trick", "Treble", "Triple play", "Grand slam"], answer: 0 },
  { id: "ronaldo-country", level: "easy", text: "Which country is Cristiano Ronaldo from?", options: ["Spain", "Brazil", "Portugal", "Italy"], answer: 2 },
  { id: "messi-country", level: "easy", text: "Which country is Lionel Messi from?", options: ["Argentina", "Spain", "Uruguay", "Brazil"], answer: 0 },
  { id: "cricket-six", level: "easy", text: "In cricket, how many runs does a batter get for hitting the ball over the boundary without it bouncing?", options: ["4", "5", "6", "8"], answer: 2 },
  { id: "cricket-four", level: "easy", text: "In cricket, how many runs is it when the ball bounces and then crosses the boundary?", options: ["2", "3", "4", "6"], answer: 2 },
  { id: "ping-pong", level: "easy", text: "\"Ping pong\" is another name for which sport?", options: ["Badminton", "Table tennis", "Squash", "Tennis"], answer: 1 },
  { id: "slam-dunk", level: "easy", text: "In which sport would you see a slam dunk?", options: ["Volleyball", "Handball", "Basketball", "Netball"], answer: 2 },
  { id: "kohli-sport", level: "easy", text: "Which sport is Virat Kohli famous for?", options: ["Football", "Cricket", "Hockey", "Kabaddi"], answer: 1 },
  { id: "olympics-every", level: "easy", text: "The Summer Olympics are normally held every how many years?", options: ["2", "3", "4", "5"], answer: 2 },
  { id: "yellow-card", level: "easy", text: "What colour card does a football referee show as a warning?", options: ["Red", "Yellow", "White", "Blue"], answer: 1 },
  { id: "federer-sport", level: "easy", text: "Which sport is Roger Federer famous for?", options: ["Golf", "Tennis", "Badminton", "Squash"], answer: 1 },
  { id: "boxing-ko", level: "easy", text: "In boxing, what does KO stand for?", options: ["Knockout", "Kick off", "Keep out", "Knock over"], answer: 0 },
  { id: "bat-ball-wickets", level: "easy", text: "Which sport is played with a bat, a ball and wickets?", options: ["Baseball", "Cricket", "Hockey", "Golf"], answer: 1 },
  { id: "rugby-ball", level: "easy", text: "What shape is a rugby ball?", options: ["Round", "Oval", "Square", "Flat"], answer: 1 },
  { id: "backstroke", level: "easy", text: "Which swimming stroke is swum lying on your back?", options: ["Butterfly", "Breaststroke", "Freestyle", "Backstroke"], answer: 3 },
  { id: "half-length", level: "easy", text: "How many minutes is each half of a standard football match?", options: ["30", "40", "45", "50"], answer: 2 },
  { id: "ipl-sport", level: "easy", text: "Which sport is the IPL (Indian Premier League)?", options: ["Football", "Kabaddi", "Cricket", "Hockey"], answer: 2 },
  { id: "cue-sport", level: "easy", text: "In which sport do players hit the ball with a cue?", options: ["Golf", "Snooker", "Croquet", "Polo"], answer: 1 },
  // ── medium ──
  { id: "tennis-zero", level: "medium", text: "In tennis, what term is used for a score of zero?", options: ["Deuce", "Love", "Fault", "Ace"], answer: 1 },
  { id: "futsal-players", level: "medium", text: "How many players per team are on the court in futsal, including the goalkeeper?", options: ["4", "5", "6", "7"], answer: 1 },
  { id: "volleyball-players", level: "medium", text: "How many players per team are on the court in indoor volleyball?", options: ["5", "6", "7", "9"], answer: 1 },
  { id: "nepal-national-sport", level: "medium", text: "What is Nepal's national sport?", options: ["Cricket", "Football", "Volleyball", "Kabaddi"], answer: 2 },
  { id: "grass-slam", level: "medium", text: "Which Grand Slam tennis tournament is played on grass?", options: ["US Open", "French Open", "Wimbledon", "Australian Open"], answer: 2 },
  { id: "clay-slam", level: "medium", text: "Which Grand Slam tennis tournament is played on clay?", options: ["French Open", "Wimbledon", "US Open", "Australian Open"], answer: 0 },
  { id: "golf-holes", level: "medium", text: "How many holes are played in a standard round of golf?", options: ["9", "12", "18", "24"], answer: 2 },
  { id: "f1-flag", level: "medium", text: "In Formula 1, which flag is waved to end the race?", options: ["Red", "Yellow", "Chequered", "Green"], answer: 2 },
  { id: "kabaddi-players", level: "medium", text: "How many players per team are on the court in kabaddi?", options: ["5", "6", "7", "9"], answer: 2 },
  { id: "rugby-players", level: "medium", text: "How many players per team are on the field in rugby union?", options: ["11", "13", "15", "18"], answer: 2 },
  { id: "wimbledon-country", level: "medium", text: "In which country is Wimbledon played?", options: ["United States", "France", "England", "Australia"], answer: 2 },
  { id: "slam-sets", level: "medium", text: "What is the most sets a men's Grand Slam singles match can have?", options: ["3", "4", "5", "7"], answer: 2 },
  { id: "duck", level: "medium", text: "In cricket, what does it mean when a batter is out for a \"duck\"?", options: ["Out first ball of the match", "Out without scoring a run", "Out caught behind", "Out hit wicket"], answer: 1 },
  { id: "wc-1975", level: "medium", text: "Which team won the first Cricket World Cup in 1975?", options: ["England", "Australia", "West Indies", "India"], answer: 2 },
  { id: "cwc-2023", level: "medium", text: "Which country won the 2023 ICC Men's Cricket World Cup?", options: ["India", "Australia", "England", "New Zealand"], answer: 1 },
  { id: "red-devils", level: "medium", text: "Which football club is nicknamed \"the Red Devils\"?", options: ["Liverpool", "Arsenal", "Manchester United", "Bayern Munich"], answer: 2 },
  { id: "rangasala", level: "medium", text: "What is the name of Nepal's national stadium in Kathmandu?", options: ["Dasharath Rangasala", "Tribhuvan Stadium", "Pokhara Rangasala", "Mulpani Stadium"], answer: 0 },
  { id: "olympic-pool", level: "medium", text: "How long is an Olympic swimming pool?", options: ["25 m", "33 m", "50 m", "100 m"], answer: 2 },
  { id: "shot-clock", level: "medium", text: "How many seconds is the shot clock in professional basketball (NBA and FIBA)?", options: ["20", "24", "30", "35"], answer: 1 },
  { id: "cricket-origin", level: "medium", text: "In which country did cricket begin?", options: ["Australia", "India", "England", "South Africa"], answer: 2 },
  { id: "first-olympics", level: "medium", text: "In which city were the first modern Olympic Games held, in 1896?", options: ["Paris", "Athens", "London", "Rome"], answer: 1 },
  { id: "free-throw", level: "medium", text: "How many points is a free throw worth in basketball?", options: ["1", "2", "3", "0.5"], answer: 0 },
  { id: "rio-2016", level: "medium", text: "Which country hosted the 2016 Summer Olympics?", options: ["China", "United Kingdom", "Brazil", "Japan"], answer: 2 },
  { id: "badminton-game", level: "medium", text: "How many points win a standard game of badminton (without extra points)?", options: ["11", "15", "21", "25"], answer: 2 },
  { id: "t20-wc-2024", level: "medium", text: "Which country won the 2024 ICC Men's T20 World Cup?", options: ["South Africa", "India", "England", "Australia"], answer: 1 },
  // ── hard ──
  { id: "super-bowl-60", level: "hard", text: "Who won Super Bowl LX (60) in February 2026?", options: ["Kansas City Chiefs", "New England Patriots", "Seattle Seahawks", "Philadelphia Eagles"], answer: 2 },
  { id: "monaco-wins", level: "hard", text: "Which driver has won the Monaco F1 Grand Prix the most times?", options: ["Ayrton Senna", "Lewis Hamilton", "Max Verstappen", "Michael Schumacher"], answer: 0 },
  { id: "marathon", level: "hard", text: "How long is a marathon?", options: ["21.1 km", "36 km", "42.195 km", "50 km"], answer: 2 },
  { id: "touchdown", level: "hard", text: "How many points is a touchdown worth in American football?", options: ["3", "6", "7", "10"], answer: 1 },
  { id: "snooker-147", level: "hard", text: "What is the maximum break in snooker?", options: ["100", "147", "155", "180"], answer: 1 },
  { id: "most-olympic-golds", level: "hard", text: "Which country has won the most Olympic gold medals of all time?", options: ["China", "Russia", "United States", "Great Britain"], answer: 2 },
  { id: "nepal-odi-captain", level: "hard", text: "Who captained Nepal when it won ODI status in 2018?", options: ["Sandeep Lamichhane", "Paras Khadka", "Rohit Paudel", "Gyanendra Malla"], answer: 1 },
  { id: "most-test-wickets", level: "hard", text: "Which bowler has taken the most wickets in Test cricket?", options: ["Shane Warne", "James Anderson", "Muttiah Muralitharan", "Anil Kumble"], answer: 2 },
  { id: "most-slams", level: "hard", text: "Which man has won the most Grand Slam singles titles in tennis?", options: ["Roger Federer", "Rafael Nadal", "Novak Djokovic", "Pete Sampras"], answer: 2 },
  { id: "hoop-height", level: "hard", text: "How high is a basketball hoop above the floor?", options: ["8 feet", "9 feet", "10 feet", "12 feet"], answer: 2 },
  { id: "wc-1930", level: "hard", text: "Which country won the first FIFA World Cup, in 1930?", options: ["Brazil", "Uruguay", "Italy", "Argentina"], answer: 1 },
  { id: "polo-players", level: "hard", text: "How many players per team are on the field in polo?", options: ["4", "6", "7", "11"], answer: 0 },
  { id: "birdie", level: "hard", text: "In golf, what is a score of one stroke under par on a hole called?", options: ["Eagle", "Bogey", "Birdie", "Albatross"], answer: 2 },
  { id: "pitch-length", level: "hard", text: "How long is a cricket pitch, from stumps to stumps?", options: ["18 yards", "20 yards", "22 yards", "25 yards"], answer: 2 },
  { id: "ballon-dor", level: "hard", text: "Which footballer has won the most Ballon d'Or awards?", options: ["Cristiano Ronaldo", "Lionel Messi", "Michel Platini", "Johan Cruyff"], answer: 1 },
];

const byId = new Map(BANK.map((q) => [q.id, q]));

// a small seeded generator: the same phone always gets the same questions
function seeded(phone: string): () => number {
  const key = process.env.QUIZ_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "sportonica-quiz";
  const digest = createHmac("sha256", key).update(`${QUIZ.id}:${phone}`).digest();
  let a = digest.readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** This phone's questions: the mix from each level, in a shuffled order, options shuffled. */
export function pickQuestions(phone: string): PlayerQuestion[] {
  const rand = seeded(phone);
  const picked = (Object.keys(QUIZ.mix) as Level[]).flatMap((level) => shuffle(BANK.filter((q) => q.level === level), rand).slice(0, QUIZ.mix[level]));
  return shuffle(picked, rand).map((q) => ({
    id: q.id, text: q.text,
    // an option's id is its place in the bank, so shuffling never changes which one is right
    options: shuffle(q.options.map((label, i) => ({ id: String(i), label })), rand),
  }));
}

/** True when `option` is the right answer to question `id`. */
export function isCorrect(id: string, option: string): boolean {
  const q = byId.get(id);
  return !!q && String(q.answer) === option;
}

/** The level and the right option of question `id`, for the host's screen. */
export function hostDetails(id: string): { level: Level; answer: string } | null {
  const q = byId.get(id);
  return q ? { level: q.level, answer: String(q.answer) } : null;
}
