import { generateOnce } from './gemini.js';

/**
 * How soon somebody should be seen, decided by a table.
 *
 * The model's only job is to name symptoms from a fixed list — it never says
 * how urgent anything is. Every level below comes from the rules in this file,
 * so the reasoning is readable, reviewable by a clinician, and identical every
 * time the same words arrive.
 *
 * This sits *below* the red-flag engine, which runs first on the patient's own
 * words and escalates outright. Nothing here can soften that: when a red flag
 * has fired, triage is never consulted at all.
 *
 * It is decision support, not a diagnosis, and it never books anything.
 */

export const CARE_LEVELS = ['EMERGENCY', 'URGENT_24H', 'URGENT_72H', 'ROUTINE', 'NEEDS_ASSESSMENT'];

/** The one place a care level becomes something the rest of the app knows. */
export const REFERRAL_PRIORITY_FOR = {
    EMERGENCY: 'emergency',
    URGENT_24H: 'urgent_24h',
    URGENT_72H: 'urgent_72h',
    ROUTINE: 'routine_7d',
    NEEDS_ASSESSMENT: null
};

/**
 * The symptom vocabulary. The model may return these strings and nothing else;
 * anything unrecognised is dropped rather than guessed at.
 *
 * Kept deliberately coarse. A longer list would look more clinical and be less
 * safe — each entry here maps to a rule somebody can defend.
 */
export const SYMPTOMS = [
    // emergency-adjacent
    'chest_pain', 'breathlessness', 'unconscious', 'seizure', 'severe_bleeding',
    'stroke_signs', 'poisoning', 'severe_burn', 'suicidal_thoughts',
    // urgent
    'high_fever', 'persistent_vomiting', 'severe_dehydration', 'severe_pain',
    'blood_in_stool', 'blood_in_urine', 'blood_in_cough', 'jaundice',
    'infant_unwell', 'pregnancy_bleeding', 'pregnancy_pain', 'reduced_fetal_movement',
    'wound_infection', 'animal_bite', 'eye_injury', 'severe_headache',
    // lower acuity
    'fever', 'cough', 'cold', 'sore_throat', 'headache', 'body_ache',
    'diarrhoea', 'vomiting', 'stomach_pain', 'skin_rash', 'weakness',
    'dizziness', 'back_pain', 'joint_pain', 'ear_pain', 'toothache',
    'constipation', 'acidity', 'minor_injury', 'checkup', 'medicine_refill'
];

/**
 * Anything here means "today, not next week".
 *
 * None of these are diagnoses — they are complaints that a clinician would
 * want to lay eyes on quickly, which is a scheduling judgement, not a clinical
 * one.
 */
const URGENT_24H_SYMPTOMS = new Set([
    'high_fever', 'persistent_vomiting', 'severe_dehydration', 'severe_pain',
    'blood_in_stool', 'blood_in_urine', 'blood_in_cough', 'jaundice',
    'infant_unwell', 'pregnancy_bleeding', 'pregnancy_pain', 'reduced_fetal_movement',
    'eye_injury', 'severe_headache', 'animal_bite'
]);

const URGENT_72H_SYMPTOMS = new Set([
    'wound_infection', 'diarrhoea', 'vomiting', 'skin_rash', 'ear_pain',
    'dizziness', 'weakness'
]);

/**
 * Emergency here is a backstop, not the main path.
 *
 * These are the same complaints the red-flag engine already catches in three
 * scripts. If one reaches this far — typed in a romanised spelling the flag
 * list does not match, for instance — it still escalates rather than being
 * quietly graded as routine.
 */
const EMERGENCY_SYMPTOMS = new Set([
    'chest_pain', 'breathlessness', 'unconscious', 'seizure', 'severe_bleeding',
    'stroke_signs', 'poisoning', 'severe_burn', 'suicidal_thoughts'
]);

/** Under five and over sixty-five tolerate less before it matters. */
const FRAGILE_YOUNG = 5;
const FRAGILE_OLD = 65;

/** Longer than this, an ordinary complaint stops being ordinary. */
const PERSISTENT_DAYS = 7;

/**
 * The decision.
 *
 * Reads as a ladder, highest first, and stops at the first rule that fires —
 * so a patient is never graded lower than any single rule says.
 */
export function decideCareLevel({ symptoms = [], durationDays = null, age = null, pregnant = false }) {
    const found = symptoms.filter(s => SYMPTOMS.includes(s));
    const reasons = [];

    if (!found.length) {
        // Silence is not reassurance. Somebody who said nothing recognisable
        // has not been assessed, and must not be told they are fine.
        return { level: 'NEEDS_ASSESSMENT', reasons: ['no_recognised_symptom'], symptoms: found };
    }

    const hit = (set) => found.filter(s => set.has(s));

    const emergency = hit(EMERGENCY_SYMPTOMS);
    if (emergency.length) {
        return { level: 'EMERGENCY', reasons: emergency.map(s => `emergency:${s}`), symptoms: found };
    }

    const urgent = hit(URGENT_24H_SYMPTOMS);
    if (urgent.length) {
        return { level: 'URGENT_24H', reasons: urgent.map(s => `urgent:${s}`), symptoms: found };
    }

    // Pregnancy and the very young or very old do not change what somebody
    // has; they change how long it is reasonable to wait with it.
    const fragile = (Number.isFinite(age) && (age <= FRAGILE_YOUNG || age >= FRAGILE_OLD)) || pregnant;
    if (fragile) reasons.push(pregnant ? 'pregnant' : 'age_vulnerable');

    const soon = hit(URGENT_72H_SYMPTOMS);
    if (soon.length) {
        reasons.push(...soon.map(s => `soon:${s}`));
        return { level: fragile ? 'URGENT_24H' : 'URGENT_72H', reasons, symptoms: found };
    }

    if (Number.isFinite(durationDays) && durationDays >= PERSISTENT_DAYS) {
        reasons.push(`persistent_${durationDays}d`);
        return { level: fragile ? 'URGENT_24H' : 'URGENT_72H', reasons, symptoms: found };
    }

    if (fragile) return { level: 'URGENT_72H', reasons, symptoms: found };

    reasons.push('routine_complaint');
    return { level: 'ROUTINE', reasons, symptoms: found };
}

const INSTRUCTION = `You label what a patient said they are feeling. You do not assess urgency.

Return ONLY a JSON object, no code fence, exactly:
{"symptoms": [], "durationDays": null, "pregnant": false}

- symptoms: choose ONLY from this exact list, at most 5:
${SYMPTOMS.join(', ')}
  Pick the closest entries to what they described. Copy the strings exactly.
  Empty array if they described nothing physical.

  Some pairs differ only in how bad the patient said it was. When they use a word
  meaning high, severe, very or a lot — "tez", "तेज़", "ਤੇਜ਼", "bahut", "severe",
  "unbearable" — or give a temperature of 39C/102F or more, choose the stronger label.
  When in doubt between the two, choose the stronger one:
    fever / high_fever
    vomiting / persistent_vomiting
    headache / severe_headache
    stomach_pain, back_pain, joint_pain / severe_pain
- durationDays: how many days they said it has lasted, as a number. "do din se" -> 2,
  "a week" -> 7, "since morning" -> 0. null if they did not say.
- pregnant: true only if they said they are pregnant. Otherwise false.

Rules:
- People speak Hindi, Punjabi and English, often mixed and in Latin letters.
- Report only what they said. Never add a symptom to be helpful.
- Never return a severity, an urgency, a care level, a diagnosis, advice, or any other field.
- Return ONLY the JSON object.`;

function parseLoose(raw) {
    const cleaned = String(raw).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(cleaned); } catch { /* fall through */ }
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * Words in, care level out.
 *
 * Returns null when there is nothing to say — a greeting, a photo, a question
 * about diabetes — so the assistant answers normally instead of grading small
 * talk. Any failure returns null too: a triage that could not run must never
 * be reported as a reassuring result.
 */
export async function triage({ text, age = null, hasFiles = false, signal }) {
    const words = String(text || '').trim();
    if (!words || hasFiles || words.length > 600) return null;

    let parsed;
    try {
        const raw = await generateOnce({
            systemInstruction: INSTRUCTION,
            contents: [{ role: 'user', parts: [{ text: words }] }],
            maxOutputTokens: 150, temperature: 0,
            responseMimeType: 'application/json', signal
        });
        parsed = parseLoose(raw);
    } catch {
        return null;
    }
    if (!parsed) return null;

    // Everything below treats the model's answer as untrusted input.
    const symptoms = Array.isArray(parsed.symptoms)
        ? [...new Set(parsed.symptoms.filter(s => SYMPTOMS.includes(s)))].slice(0, 5)
        : [];
    if (!symptoms.length) return null; // nothing physical was described

    const d = Number(parsed.durationDays);
    const durationDays = Number.isFinite(d) && d >= 0 && d <= 3650 ? Math.round(d) : null;
    const pregnant = parsed.pregnant === true;

    const decision = decideCareLevel({ symptoms, durationDays, age, pregnant });
    return {
        ...decision,
        durationDays,
        pregnant,
        referralPriority: REFERRAL_PRIORITY_FOR[decision.level]
    };
}
