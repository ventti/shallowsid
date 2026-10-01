// Numeric filters in the search bar: "bpm>=120 & bpm<130", "year=1987 | year=1988",
// "length>5:00", mixed with words ("hubbard bpm>140"). Pure, for `node --test`.
//
// A comparison is FIELD OP VALUE with OP one of = == != > < >= <=. Comparisons
// join with & (and; also just a space) and | (or); & binds tighter, so
// "a | b & c" is "a | (b & c)". Everything else is text for the word search,
// including comparisons of anything but FIELDS, so titles like "C=64" or
// "2 Hours = NOT Enough" are still found. A value that's unknown (no BPM, no
// exact year) never matches.

// level "sub": a value per subtune, so results are subtunes; "tune": one per file.
export const FIELDS = {
  bpm: { level: "sub", label: "BPM", aliases: ["tempo"] },
  length: { level: "sub", label: "length", aliases: ["len", "time", "duration"], time: true },
  year: { level: "tune", label: "year" },
  subtunes: { level: "tune", label: "subtunes", aliases: ["songs"] },
  subtune: { level: "sub", label: "subtune", aliases: ["song"] },
};

const FIELD_BY_NAME = new Map(Object.entries(FIELDS).flatMap(([id, f]) => [[id, id], ...(f.aliases ?? []).map((a) => [a, id])]));
const OPS = { "=": (a, b) => a === b, "==": (a, b) => a === b, "!=": (a, b) => a !== b, ">": (a, b) => a > b, "<": (a, b) => a < b, ">=": (a, b) => a >= b, "<=": (a, b) => a <= b };
const SHOWN_OP = { "=": "=", "==": "=", "!=": "≠", ">": ">", "<": "<", ">=": "≥", "<=": "≤" };
// A comparison, a connector, or any other run of characters (a word).
const TOKEN = /\s*(?:([a-z]+)\s*(>=|<=|!=|==|=|>|<)\s*([\d:.]*)|(&&?|\|\|?)|([^\s&|]+))/giy;

// {text, filter, error, unknown}: filter is null without comparisons, else an
// OR of AND groups: [[{field, op, value}, ...], ...]. unknown lists the names
// compared that aren't fields (searched as text), for a hint when nothing matches.
export function parseQuery(query) {
  const tokens = [];
  TOKEN.lastIndex = 0;
  const input = String(query ?? "");
  let m;
  while (TOKEN.lastIndex < input.length && (m = TOKEN.exec(input))) {
    if (m[1] && FIELD_BY_NAME.has(m[1].toLowerCase())) tokens.push({ kind: "cmp", name: m[1].toLowerCase(), op: m[2], raw: m[3] });
    else if (m[1]) tokens.push({ kind: "word", text: m[0].trim(), unknown: m[1].toLowerCase() });
    else if (m[4]) tokens.push({ kind: m[4][0] === "|" ? "or" : "and" });
    else if (m[5]) tokens.push({ kind: "word", text: m[5] });
  }
  const unknown = tokens.filter((t) => t.unknown).map((t) => t.unknown);
  if (!tokens.some((t) => t.kind === "cmp")) return { text: input.trim(), filter: null, error: null, unknown };

  const words = [];
  const groups = [[]];
  for (const t of tokens) {
    if (t.kind === "word") words.push(t.text);
    else if (t.kind === "or") { if (groups.at(-1).length) groups.push([]); }
    else if (t.kind === "cmp") {
      const field = FIELD_BY_NAME.get(t.name);
      const value = parseValue(t.raw, FIELDS[field]);
      if (value === null) return { text: "", filter: null, error: `“${t.name}${t.op}${t.raw}” needs a number${FIELDS[field].time ? " or m:ss" : ""} after ${t.op}.`, unknown };
      groups.at(-1).push({ field, op: t.op, value });
    }
  }
  return { text: words.join(" "), filter: groups.filter((g) => g.length), error: null, unknown };
}

function parseValue(raw, field) {
  if (field.time && /^\d+:\d{1,2}$/.test(raw)) {
    const [min, sec] = raw.split(":").map(Number);
    return min * 60 + sec;
  }
  return /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : null;
}

// For an empty result: how to compare numbers, when the query compared something else.
export const fieldHint = (unknown) => (unknown?.length ? `To compare numbers, use ${Object.keys(FIELDS).join(", ")}.` : "");

// Whether `valueOf(field)` (a number, or null when unknown) passes the filter.
export function matches(filter, valueOf) {
  return filter.some((group) => group.every(({ field, op, value }) => {
    const v = valueOf(field);
    return v !== null && v !== undefined && OPS[op](v, value);
  }));
}

// Whether any comparison needs a value per subtune.
export const perSubtune = (filter) => filter.some((group) => group.some(({ field }) => FIELDS[field].level === "sub"));

const shownValue = (field, value) => (FIELDS[field].time ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}` : String(value));

// "BPM ≥ 120 and BPM < 130, or year = 1987", for the results' heading.
export function describe(filter) {
  return filter.map((group) => group.map(({ field, op, value }) => `${FIELDS[field].label} ${SHOWN_OP[op]} ${shownValue(field, value)}`).join(" and ")).join(", or ");
}

// The year a tune came out, when HVSC's "released" gives it exactly ("1987 ...", not "198?").
export function exactYear(released = "") {
  const m = String(released).match(/^(\d{4})(?:-\d{2,4})?(?:\s|$)/);
  return m ? Number(m[1]) : null;
}
