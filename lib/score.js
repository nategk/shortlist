// Claude reads the search's own criteria and judges crawled listings, so
// scoring works for any kind of search without search-specific code.
//   screen(): one call over every new candidate -> which deserve a closer look
//   score():  one call per shortlisted listing -> fit score, summary, metric
//             values and the card's standard details
// Needs ANTHROPIC_API_KEY. Without it, crawls still add listings, unscored.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const MODEL = "claude-opus-5";

export const scoringEnabled = () => !!process.env.ANTHROPIC_API_KEY;

let client = null;
const claude = () => (client ||= new Anthropic());

function brief(search) {
  return [
    `Search: ${search.name}`,
    search.lookingFor && `Looking for: ${search.lookingFor}`,
    search.budget && `Budget: ${search.budget}`,
    search.area && `Area: ${search.area}`,
    search.timing && `Timing: ${search.timing}`,
    "",
    "Criteria and scoring rubric (written by the person searching):",
    search.criteria || "(none given; judge on the fields above)",
    ...((search.features || []).length ? ["",
      "Features that matter (bonus points are added to the fit score automatically; don't count them in your score):",
      ...search.features.map(f => `- ${f.label} (+${f.points})`)] : []),
  ].filter(x => x !== undefined && x !== false).join("\n");
}

const ScreenSchema = z.object({
  keep: z.array(z.object({ key: z.string(), reason: z.string() })),
});

// Returns the subset of candidate keys worth fetching and scoring, capped at `limit`.
// `board` is what's already listed ({title, price, location}), so reposts of
// the same unit under a new title are left out.
export async function screen(search, candidates, limit = 12, board = []) {
  if (!candidates.length) return [];
  const lines = candidates.map(c => JSON.stringify({
    key: c.key, title: c.title, price: c.price ?? c.priceText, location: c.location,
    ...(c.lat != null ? { lat: c.lat, lon: c.lon } : {}), ...(c.availability ? { availability: c.availability } : {}),
  }));
  const response = await claude().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: "You help one person triage listings for a search they defined. Be strict: only keep listings that could plausibly meet the must-haves. Titles and locations from listing sites are often vague or wrong; use coordinates when given.",
    messages: [{
      role: "user",
      content: `${brief(search)}\n\n${board.length ? `Already on the board (don't return reposts of these: same building/unit at a similar price, reworded):\n${board.slice(0, 300).map(b => `- ${b.title} · ${b.price ?? "?"} · ${b.location || "?"}`).join("\n")}\n\n` : ""}New candidates (one JSON object per line):\n${lines.join("\n")}\n\nReturn the keys worth fetching in full and scoring, best first, at most ${limit}. Leave out anything that clearly breaks a must-have (wrong area, wrong size, over budget, wrong dates, wanted/seeking posts, rooms/shares when a whole unit is wanted), reposts of listings already on the board, and duplicates within the candidates (keep one).`,
    }],
    output_config: { format: zodOutputFormat(ScreenSchema) },
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return [];
  const valid = new Set(candidates.map(c => c.key));
  return response.parsed_output.keep.map(k => k.key).filter(k => valid.has(k)).slice(0, limit);
}

// The card's standard details (the fields hand-curated listings carry, which
// the card renders: place, lease, subway lines, contact). [key, field, ask].
const DETAILS = [
  ["address", "Address", "street address without the unit, e.g. \"148 W 68th St\"; null if no street number is given"],
  ["neighborhood", "Neighborhood", "neighborhood name only"],
  ["building", "Building", "the building's name if it has one (not just its address)"],
  ["unit", "Unit", "beds/baths, unit number and floor, exposure, then the unit's notable features, one short line each"],
  ["moveIn", "Move-in", "earliest move-in, e.g. \"Oct 1\", \"Now\", or \"Not stated (ask)\""],
  ["moveOut", "Move-out", "lease end if stated, e.g. \"May 31, 2027\""],
  ["lease", "Lease", "lease type and term, renewal, furnished or not, fees, in one line"],
  ["subways", "Subways", "nearest subway lines with miles to the closest entrance of each, nearest first, up to 5, formatted \"1 0.12 · 2 0.30 · B 0.40\""],
  ["subwayLine", "Subway line", "nearest station, e.g. \"1 · 66 St–Lincoln Center\""],
  ["contact", "Contact", "who to reach: name and company"],
  ["contactInfo", "Contact info", "phones, emails or links to reach them, separated by \" · \""],
  ["buildingSpecs", "Building & specs", "building amenities and specs in one line, separated by \" · \""],
  ["costBreakdown", "Cost breakdown", "monthly all-in cost: rent + estimated utilities + parking + amenity fees, each with a short note, e.g. \"All-in ≈ $4,450/mo: rent $3,750 + utils ~$100 (electric) + parking ~$600 (nearby garage, est.) + amenity $0\"; use the same total for any all-in or total-cost card field above"],
];

const ScoreSchema = z.object({
  score: z.number().int(),
  summary: z.string(),
  title: z.string(),
  location: z.string(),
  metrics: z.array(z.object({ field: z.string(), value: z.string() })),
  details: z.object({
    ...Object.fromEntries(DETAILS.map(([k]) => [k, z.string().nullable()])),
    termMonths: z.number().nullable(),
  }),
  features: z.array(z.string()),
});

// Full judgment on one listing. Returns null when Claude declines or fails.
export async function score(search, listing) {
  const metricSpec = (search.metrics || []).map(m => `- "${m.field}"${m.unit ? ` (in ${m.unit})` : ""}`).join("\n") || "(none)";
  const response = await claude().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: "You score one listing against a person's own search criteria, as a sharp, candid advisor. Use the rubric exactly as written, including modifiers. Never invent facts: when something that matters is unknown, say so and score it as the rubric says for unknowns.",
    messages: [{
      role: "user",
      content: `${brief(search)}\n\nListing:\nURL: ${listing.url}\nTitle: ${listing.title}\nPrice: ${listing.price ?? "unknown"}\nLocation: ${listing.location || "unknown"}\nExtra data: ${JSON.stringify(listing.raw || {})}\n\nDescription:\n${(listing.description || "").slice(0, 8000)}\n\nReturn:\n- score: fit score on the rubric's scale, modifiers applied\n- summary: 2-4 sentences for the card: why it fits, what misses, what to ask. End with the score breakdown in one line.\n- title: short card title: address or building, then the 2-3 things that matter most\n- location: neighborhood · cross streets or address\n- metrics: values for these card fields, estimated from the address/coordinates where needed (numbers only, in the unit shown; for text fields a few words); omit any you can't estimate:\n${metricSpec}\n- details: these card fields, from the listing (subway distances and costs may be estimated from the address/coordinates); null for anything not stated or not applicable:
${DETAILS.map(([k, , ask]) => `  - ${k}: ${ask}`).join("\n")}
  - termMonths: lease length in months, as a number
- features: which of the listed features that matter this listing clearly has (its building counts), using the labels exactly as written; leave out anything not stated or unclear`,
    }],
    output_config: { format: zodOutputFormat(ScoreSchema) },
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  const out = response.parsed_output;
  const fields = {};
  for (const [k, field] of DETAILS) if (out.details?.[k]?.trim()) fields[field] = out.details[k].trim();
  if (out.details?.termMonths > 0) fields["Term (months)"] = out.details.termMonths;
  for (const { field, value } of out.metrics) {
    const n = Number(String(value).replace(/[^\d.-]/g, ""));
    fields[field] = /^[\s~≈]*-?[\d.]+\s*[a-z]*$/i.test(value) && isFinite(n) ? n : value;
  }
  const labels = new Map((search.features || []).map(f => [f.label.toLowerCase(), f.label]));
  const features = [...new Set(out.features.map(f => labels.get(String(f).toLowerCase())).filter(Boolean))];
  return { score: out.score, summary: out.summary, title: out.title, location: out.location, fields, features };
}
