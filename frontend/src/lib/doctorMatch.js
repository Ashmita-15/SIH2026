/**
 * Hearing a doctor's name through an accent.
 *
 * The old matcher needed the transcript to *contain* the stored name. That
 * works when a name is typed and fails almost every time it is spoken: a
 * patient saying "Amreet" or "Mira" is naming a real doctor, and substring
 * containment says they named nobody.
 *
 * Three ideas, in descending order of trust:
 *
 * 1. Exact or prefix token match — "Meera", "Mee" for Meera Sharma.
 * 2. A consonant skeleton. Romanised Indian names vary mostly in their vowels
 *    ("Amrit"/"Amreet", "Meera"/"Mira", "Sunita"/"Suneeta"), so dropping the
 *    vowels makes those spellings identical while keeping different names
 *    apart. This is what actually rescues accented speech.
 * 3. Edit distance and shared bigrams, as a floor for everything else.
 *
 * Every score is a *ranking* input, never a decision on its own. A single
 * clear leader is selected; anything closer than that becomes a question.
 * Nothing here is aliased to a specific doctor — the whole file works off the
 * names the availability API returned.
 */

/**
 * Honorifics in the languages the app speaks, plus the Latin spellings people
 * dictate. Removed rather than scored: "doctor" is how you address anybody in
 * this list, so it distinguishes nobody.
 */
const HONORIFICS = new Set([
    'dr', 'dr.', 'doctor', 'doctors', 'doc',
    'डॉ', 'डॉ.', 'डा', 'डा.', 'डाक्टर', 'डॉक्टर', 'डाॅक्टर',
    'ডা', 'ডা.', 'ডাঃ', 'ডাক্তার'
]);

/** Words that carry no name, in any of the three flows. */
const FILLER = new Set([
    'ko', 'se', 'ke', 'ki', 'ka', 'mujhe', 'main', 'mera', 'meri',
    'chahiye', 'dikhana', 'milna', 'baat', 'karni', 'karna', 'appointment',
    'with', 'the', 'to', 'see', 'want', 'i', 'a', 'an', 'please', 'book',
    'को', 'से', 'के', 'की', 'का', 'मुझे', 'चाहिए', 'दिखाना', 'मिलना',
    'ला', 'शी', 'यांना', 'हवे', 'आहे', 'भेटायचे', 'बोलायचे'
]);

/**
 * Lowercase, unpunctuated, honorific-free words.
 *
 * Devanagari is kept as-is: `\p{L}` plus `\p{M}` so that vowel signs — which
 * are combining marks, not letters — survive. A letters-only filter turns
 * मीरा into मरा and matches nothing.
 */
export function normalise(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function tokenise(text) {
    return normalise(text)
        .split(' ')
        .filter(w => w && !HONORIFICS.has(w) && !FILLER.has(w));
}

/** Name tokens worth matching against. Honorifics are already gone. */
export const nameTokens = (name) => tokenise(name).filter(w => w.length >= 2);

/**
 * Devanagari consonants, as the Latin letter each one is romanised to.
 *
 * Needed because the two sides of the comparison are in different scripts:
 * doctor names are stored in Latin, and a patient speaking Hindi or Marathi
 * produces Devanagari. Without this, "मीरा" and "Meera" share no characters
 * and score zero — the Hindi and Marathi flows could never name a doctor
 * except through the extractor's romanisation.
 *
 * Only consonants are listed. Vowels and vowel signs are dropped anyway, so
 * they never need a mapping, and the same folding that makes "sh"→"s" for
 * Latin is applied here by writing श as "s" directly.
 */
const DEVANAGARI_CONSONANTS = {
    क: 'k', ख: 'k', ग: 'g', घ: 'g', ङ: 'n',
    च: 'c', छ: 'c', ज: 'j', झ: 'j', ञ: 'n',
    ट: 't', ठ: 't', ड: 'd', ढ: 'd', ण: 'n',
    त: 't', थ: 't', द: 'd', ध: 'd', न: 'n',
    प: 'p', फ: 'f', ब: 'b', भ: 'b', म: 'm',
    य: 'y', र: 'r', ल: 'l', व: 'v', ळ: 'l',
    श: 's', ष: 's', स: 's', ह: 'h',
    // Nukta forms, which Devanagari input produces as separate letters.
    क़: 'k', ख़: 'k', ग़: 'g', ज़: 'j', ड़: 'd', ढ़: 'd', फ़: 'f'
};

/** Devanagari word → its Latin consonant run. Non-Devanagari passes through. */
function devanagariSkeleton(word) {
    let out = '';
    for (const ch of word) {
        const c = DEVANAGARI_CONSONANTS[ch];
        if (c) out += c;
        // Vowels, vowel signs, virama and anusvara are deliberately dropped.
    }
    return out;
}

/**
 * The consonants, in order, with the noise of transliteration folded out.
 *
 * Digraph folding first (sh→s, th→t, ph→f …) so that "Sharma" and "Sarma"
 * reduce alike, then vowels go. Devanagari takes the transliteration route to
 * the same alphabet, so both scripts end up comparable.
 */
function skeleton(word) {
    if (/[ऀ-ॿ]/.test(word)) {
        return devanagariSkeleton(word)
            .replace(/(.)\1+/g, '$1')
            .replace(/[aeiouy]/g, '');
    }
    if (!/^[a-z]+$/.test(word)) return word;
    return word
        .replace(/(.)\1+/g, '$1')       // aa, ee, tt → a, e, t
        .replace(/ph/g, 'f')
        .replace(/(kh|gh|ch|jh|th|dh|bh|sh)/g, (m) => m[0])
        .replace(/ksh|x/g, 'k')
        .replace(/[wv]/g, 'v')
        .replace(/[zj]/g, 'j')
        .replace(/[aeiouy]/g, '')
        .replace(/(.)\1+/g, '$1');      // folding can re-create doubles
}

function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length || !b.length) return Math.max(a.length, b.length);
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) {
            row[j] = Math.min(
                prev[j] + 1,
                row[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        prev = row;
    }
    return prev[b.length];
}

const editRatio = (a, b) => {
    const longest = Math.max(a.length, b.length);
    return longest ? 1 - levenshtein(a, b) / longest : 0;
};

function diceBigrams(a, b) {
    if (a.length < 2 || b.length < 2) return 0;
    const grams = (s) => {
        const out = new Map();
        for (let i = 0; i < s.length - 1; i++) {
            const g = s.slice(i, i + 2);
            out.set(g, (out.get(g) || 0) + 1);
        }
        return out;
    };
    const ga = grams(a);
    const gb = grams(b);
    let shared = 0;
    for (const [g, n] of ga) shared += Math.min(n, gb.get(g) || 0);
    return (2 * shared) / (a.length - 1 + b.length - 1);
}

/**
 * Vowels, reduced to the three places a mouth puts them.
 *
 * Transliteration varies *within* a class — "Meera"/"Mira", "Suneeta"/"Sunita"
 * — and almost never across one. This is what stops the consonant skeleton
 * from being reckless: "Amar" and "Meera" both reduce to `mr`, and only the
 * vowels say they are different people.
 */
const VOWEL_CLASS = { a: 'a', e: 'i', i: 'i', y: 'i', o: 'u', u: 'u' };

const vowelSeq = (word) => {
    const latin = /[ऀ-ॿ]/.test(word) ? '' : word;
    return [...latin].map(c => VOWEL_CLASS[c]).filter(Boolean).join('');
};

/**
 * Do two spellings agree about their vowels?
 *
 * Devanagari carries its vowels as combining marks that the transliteration
 * drops, so there is nothing to compare across scripts — those pairs are let
 * through on the consonants alone, which is the best evidence available.
 */
function vowelsAgree(a, b) {
    const va = vowelSeq(a);
    const vb = vowelSeq(b);
    if (!va || !vb) return true; // cross-script: no vowel evidence either way
    if (va[0] !== vb[0]) return false;
    return editRatio(va, vb) >= 0.4;
}

/** Scores above this are trusted enough to be *a* candidate. */
export const CANDIDATE_FLOOR = 0.66;
/** A leader must reach this to be selected without asking. */
export const ACCEPT_SCORE = 0.85;
/** …and be this far clear of the runner-up. Ties are questions. */
export const ACCEPT_MARGIN = 0.10;

/** How well one spoken word matches one name word. */
function tokenScore(said, real) {
    if (said === real) return 1;

    // A prefix is how people shorten a name, and how ASR truncates one.
    const short = said.length < real.length ? said : real;
    const long = short === said ? real : said;
    if (short.length >= 3 && long.startsWith(short)) return 0.92;

    /**
     * Same consonants. Strong enough to select on only when the vowels agree
     * too — otherwise it is offered as a candidate and the patient decides.
     * "Amar" against a list containing Meera Sharma must ask, not book.
     */
    const ks = skeleton(said);
    const kr = skeleton(real);
    if (ks && kr && ks === kr && ks.length >= 2) {
        return vowelsAgree(said, real) ? 0.88 : 0.80;
    }

    // Everything else is a floor, never enough on its own to auto-select.
    return Math.min(0.80, Math.max(editRatio(said, real), diceBigrams(said, real)));
}

/**
 * Rank every doctor against what the patient said.
 *
 * Scored per word-pair and reduced by the best pair, with a small bonus when
 * two spoken words land on two different parts of the same name — "Meera
 * Sharma" should beat a lone "Sharma" when both are in the list.
 */
export function rankDoctors(said, doctors) {
    const saidTokens = tokenise(said);
    if (!saidTokens.length || !doctors?.length) return [];

    return doctors
        .map((doctor) => {
            const real = nameTokens(doctor.name);
            if (!real.length) return { doctor, score: 0 };

            let best = 0;
            const hitNameTokens = new Set();
            for (const s of saidTokens) {
                let bestForToken = 0;
                let bestReal = null;
                for (const r of real) {
                    const score = tokenScore(s, r);
                    if (score > bestForToken) { bestForToken = score; bestReal = r; }
                }
                if (bestForToken >= 0.85 && bestReal) hitNameTokens.add(bestReal);
                best = Math.max(best, bestForToken);
            }

            /**
             * Naming two parts of the same name beats naming one.
             *
             * Left uncapped on purpose: with a cap, "Meera Sharma" and
             * "Rakesh Sharma" both top out at 1.0 when the patient says
             * "Meera Sharma", the margin collapses, and the flow asks a
             * question it already has the answer to. Counting *distinct*
             * parts of the stored name — not spoken words — means stray
             * filler in a sentence cannot dilute the score.
             */
            const score = best + 0.10 * Math.max(0, hitNameTokens.size - 1);
            return { doctor, score };
        })
        .filter(r => r.score >= CANDIDATE_FLOOR)
        .sort((a, b) => b.score - a.score || a.doctor.name.localeCompare(b.doctor.name));
}

/**
 * The decision.
 *
 * Selects only a leader that is both strong and clearly ahead. Two names that
 * sound alike return both, because picking one of them for the patient is the
 * failure mode this whole file exists to avoid.
 */
export function matchDoctor(said, doctors) {
    const ranked = rankDoctors(said, doctors);
    if (!ranked.length) return { doctor: null, candidates: [], confidence: 0 };

    const [top, second] = ranked;
    const clear = !second || top.score - second.score >= ACCEPT_MARGIN;
    if (top.score >= ACCEPT_SCORE && clear) {
        return { doctor: top.doctor, candidates: [], confidence: Math.min(1, top.score) };
    }

    return {
        doctor: null,
        candidates: ranked.slice(0, 5).map(r => r.doctor),
        confidence: Math.min(1, top.score)
    };
}

/**
 * "The second one", in every form the three languages produce.
 *
 * Ordinals and numerals only. An affirmation must not read as a choice — "हाँ"
 * answers a different question, and treating it as "1" would book the first
 * name on a list the patient never picked from.
 */
const CHOICE_WORDS = {
    1: ['one', 'first', '1st', 'ek', 'pehla', 'pehli', 'pahila', 'pahili',
        'एक', 'पहला', 'पहली', 'पहिला', 'पहिली'],
    2: ['two', 'second', '2nd', 'do', 'don', 'dusra', 'dusri', 'dusara', 'dusari',
        'दो', 'दोन', 'दूसरा', 'दूसरी', 'दुसरा', 'दुसरी'],
    3: ['three', 'third', '3rd', 'teen', 'tin', 'tisra', 'tisri', 'tisara',
        'तीन', 'तीसरा', 'तीसरी', 'तिसरा', 'तिसरी'],
    4: ['four', 'fourth', '4th', 'char', 'chautha', 'chautha', 'chotha',
        'चार', 'चौथा', 'चौथी', 'चौथे'],
    5: ['five', 'fifth', '5th', 'paanch', 'panch', 'pach', 'pachva',
        'पाँच', 'पांच', 'पाच', 'पाँचवा', 'पाचवा']
};

/** Devanagari digits, which ASR does emit. */
const DEVANAGARI_DIGITS = { '१': 1, '२': 2, '३': 3, '४': 4, '५': 5 };

/**
 * Which of `count` options the patient named, or null.
 *
 * Returns null rather than a guess for anything outside the list on screen —
 * "7" against three doctors is a misunderstanding, not the seventh doctor.
 */
export function parseChoice(text, count) {
    if (!count) return null;
    const words = normalise(text).split(' ').filter(Boolean);
    if (!words.length || words.length > 4) return null;

    for (const w of words) {
        if (/^[1-9]$/.test(w)) {
            const n = Number(w);
            return n <= count ? n : null;
        }
        if (DEVANAGARI_DIGITS[w]) {
            const n = DEVANAGARI_DIGITS[w];
            return n <= count ? n : null;
        }
        for (const [n, forms] of Object.entries(CHOICE_WORDS)) {
            if (forms.includes(w)) return Number(n) <= count ? Number(n) : null;
        }
    }
    return null;
}

/** "1. Dr. Meera Sharma, 2. Dr. Amrit Singh" — the list the patient answers. */
export const numberList = (doctors) =>
    doctors.map((d, i) => `${i + 1}. ${d.name}`).join(', ');
