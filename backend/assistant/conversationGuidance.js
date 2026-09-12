import { generateOnce } from './gemini.js';
import { INTENTS } from './intentRouter.js';

/**
 * Guided care conversation — read-only.
 *
 * The navigation router answers "where does this sentence go?". This answers
 * the slower question: "does this person still need to tell me something before
 * going there?" — and, if so, asks one short question and waits.
 *
 * Three properties matter more than anything else here:
 *
 * 1. It never acts. It reads, asks, summarises and points at an existing
 *    screen. No booking, no record, no referral, no task.
 * 2. It never speaks in its own words. Every sentence the patient hears comes
 *    from the fixed templates below, so the model cannot volunteer a diagnosis,
 *    an urgency judgement, or a promise that somebody has been booked.
 * 3. It holds no state. The transcript is already sent with every turn, so the
 *    session is recomputed and thrown away each time. Nothing to store, nothing
 *    to expire, and changing your mind mid-flow needs no special handling — the
 *    next turn simply derives a different goal.
 */

/** The goals a conversation may have. Anything else is ordinary chat. */
const GOALS = ['FIND_DOCTOR', 'VIEW_RECORDS', 'VIEW_APPOINTMENTS', 'FIND_MEDICINE', 'EMERGENCY', 'GENERAL_CARE_GUIDANCE'];

/**
 * Only FIND_DOCTOR is guided. The others are a single step — there is nothing
 * to ask about "show me my records" — so they keep the existing behaviour
 * exactly: navigate, and answer normally.
 */
const GUIDED = 'FIND_DOCTOR';

const MIN_CONFIDENCE = 0.7;
const MAX_COMMAND_CHARS = 300;
const RECENT_TURNS = 6;

/** Closed set: a free-text time would end up in a sentence read to the patient. */
const TIMES = ['morning', 'afternoon', 'evening', 'night', 'today', 'tomorrow', 'soon'];

const TIME_LABEL = {
    en: { morning: 'in the morning', afternoon: 'in the afternoon', evening: 'in the evening', night: 'at night', today: 'today', tomorrow: 'tomorrow', soon: 'as soon as possible' },
    hi: { morning: 'सुबह', afternoon: 'दोपहर', evening: 'शाम को', night: 'रात को', today: 'आज', tomorrow: 'कल', soon: 'जल्दी' },
    mr: { morning: 'सकाळी', afternoon: 'दुपारी', evening: 'संध्याकाळी', night: 'रात्री', today: 'आज', tomorrow: 'उद्या', soon: 'लवकरात लवकर' },
    bn: { morning: 'সকালে', afternoon: 'দুপুরে', evening: 'সন্ধ্যায়', night: 'রাতে', today: 'আজ', tomorrow: 'আগামীকাল', soon: 'যত তাড়াতাড়ি সম্ভব' }
};

/**
 * The only questions this system can ask, in the only words it can use.
 *
 * One question, never a list. Kept short and plain because the person hearing
 * it may not read, may be unwell, and is listening rather than scanning.
 */
const ASK_TIME = {
    en: 'Alright, I can help you find a doctor. When would you like to speak to a doctor?',
    hi: 'ठीक है, मैं डॉक्टर ढूँढने में आपकी मदद करता हूँ। आप डॉक्टर से कब बात करना चाहेंगे?',
    mr: 'ठीक आहे, मी तुम्हाला डॉक्टर शोधण्यात मदत करू शकतो. तुम्ही डॉक्टरांशी कधी बोलू इच्छिता?',
    bn: 'ঠিক আছে, আমি আপনাকে ডাক্তার খুঁজে পেতে সাহায্য করতে পারি। আপনি কখন ডাক্তারের সাথে কথা বলতে চান?'
};

/** Tap targets for the question above — faster than saying it, for anyone who can tap. */
const TIME_CHOICES = {
    en: ['In the morning', 'In the evening', 'As soon as possible'],
    hi: ['सुबह', 'शाम को', 'जितनी जल्दी हो सके'],
    mr: ['सकाळी', 'संध्याकाळी', 'लवकरात लवकर'],
    bn: ['সকালে', 'সন্ধ্যায়', 'যত তাড়াতাড়ি সম্ভব']
};

const CANCELLED = {
    en: 'No problem. I have not booked anything. Tell me whenever you need help.',
    hi: 'कोई बात नहीं। मैंने कुछ भी बुक नहीं किया है। जब भी ज़रूरत हो, मुझे बताइए।',
    mr: 'काही अडचण नाही. मी काहीही बुक केलेले नाही. जेव्हा गरज असेल तेव्हा मला सांगा.',
    bn: 'কোনো সমস্যা নেই। আমি কিছু বুক করিনি। যখনই সাহায্যের প্রয়োজন হবে, আমাকে জানাবেন।'
};

/**
 * The hand-off line. It deliberately says the list is being opened, never that
 * an appointment exists or that a doctor is free — nothing here has checked
 * either, and this milestone books nothing.
 */
function summarise({ lang, symptoms, time }) {
    const label = time ? TIME_LABEL[lang][time] : null;
    const said = symptoms.join(', ');

    /**
     * The summary runs straight on into asking which doctor.
     *
     * Said in the same breath so somebody listening rather than reading is
     * handed the next question immediately, and the voice loop can go back to
     * listening once — rather than speaking, stopping, and needing a second
     * prompt from somewhere else. The question names no doctors: the list is
     * real application data and belongs to the client, not to this sentence.
     */
    if (lang === 'hi') {
        const parts = [];
        if (said) parts.push(`आपने बताया कि आपको ${said} है`);
        if (label) parts.push(`और आप ${label} डॉक्टर से बात करना चाहते हैं`);
        const recap = parts.length ? `ठीक है। ${parts.join(' ')}। ` : 'ठीक है। ';
        return `${recap}मैं आपके लिए डॉक्टरों की सूची खोल रहा हूँ। आप किस डॉक्टर को चुनना चाहेंगे?`;
    }
        if (lang === 'mr') {
        const parts = [];
        if (said) parts.push(`तुम्ही सांगितले की तुम्हाला ${said} चा त्रास आहे`);
        if (label) parts.push(`आणि तुम्ही ${label} डॉक्टरांशी बोलू इच्छिता`);
        const recap = parts.length ? `ठीक आहे. ${parts.join(' ')}. ` : 'ठीक आहे. ';
        return `${recap}मी तुमच्यासाठी डॉक्टरांची यादी उघडत आहे. तुम्ही कोणत्या डॉक्टरांना भेटू इच्छिता?`;
    }
    if (lang === 'bn') {
        const parts = [];
        if (said) parts.push(`আপনি জানিয়েছেন আপনার ${said} রয়েছে`);
        if (label) parts.push(`এবং আপনি ${label} ডাক্তারের সাথে কথা বলতে চান`);
        const recap = parts.length ? `ঠিক আছে। ${parts.join(' ')}। ` : 'ঠিক আছে। ';
        return `${recap}আমি আপনার জন্য ডাক্তারদের তালিকা খুলছি। আপনি কোন ডাক্তারকে দেখাতে চান?`;
    }
    const parts = [];
    if (said) parts.push(`you mentioned ${said}`);
    if (label) parts.push(`and you would like to speak to a doctor ${label}`);
    const recap = parts.length ? `Alright. So ${parts.join(' ')}. ` : 'Alright. ';
    return `${recap}I am opening the list of doctors for you. Which doctor would you like to see?`;
}

/**
 * Booking hints: what the patient referred to, never what should happen.
 *
 * This is the only place the model touches the booking conversation, and it is
 * deliberately toothless. It returns a name the patient said, a relative day,
 * and a clock hour — three pieces of language. It cannot return a doctor id, a
 * date, a slot string or a decision, because it is never asked for one and
 * anything resembling one is stripped below.
 *
 * Resolving these hints against real doctors and real availability, and
 * deciding whether anything gets booked, happens in deterministic client code.
 */
const BOOKING_INSTRUCTION = `You extract what a patient referred to while arranging a doctor's appointment.

Return ONLY a JSON object, no code fence, exactly this shape:
{"doctorHint": null, "dateHint": null, "hourHint": null, "bandHint": null}

- doctorHint: a doctor's NAME the patient just referred to, written in LATIN letters.
  Doctor names are stored in Latin script, so romanise what the patient said:
  "मीरा शर्मा" -> "Meera Sharma", "অমৃত সিং" -> "Amrit Singh". Transliterate only;
  never translate, correct or complete a name they did not say. null if they named nobody.
- dateHint: "today", "tomorrow" or "day_after" — only if they clearly said one of those. Otherwise null.
- hourHint: the clock hour they asked for, as a plain number 1 to 24. "5 बजे" -> 5. "shaam 5 baje" -> 5.
  "four o'clock" -> 4. null if they named no hour.
- bandHint: "morning", "afternoon" or "evening" if they named a part of the day rather than an hour.
  "सुबह"/"subah" -> morning. "दोपहर"/"dopahar" -> afternoon. "शाम"/"shaam"/"संध्याकाळ" -> evening. Otherwise null.

Rules:
- People speak Hindi, Marathi, Bengali and English, often mixed and often in Latin letters. Judge meaning, not spelling.
- Report only what the patient actually said. Never fill a field to be helpful.
- Never return an id, a route, a path, a date in any format, a time range, code, or any explanation.
- Return ONLY the JSON object.`;

const DATE_HINTS = ['today', 'tomorrow', 'day_after'];

export async function extractBookingHints({ messages = [], lang = 'en', signal }) {
    const latest = [...messages].reverse().find(m => m.role !== 'assistant');
    const words = String(latest?.text || '').trim();
    const empty = { doctorHint: null, dateHint: null, hourHint: null, bandHint: null };
    if (!words || words.length > MAX_COMMAND_CHARS) return empty;

    let parsed;
    try {
        const raw = await generateOnce({
            systemInstruction: BOOKING_INSTRUCTION,
            contents: [{ role: 'user', parts: [{ text: words }] }],
            maxOutputTokens: 80,
            temperature: 0,
            responseMimeType: 'application/json',
            signal
        });
        parsed = parseLoose(raw);
    } catch {
        return empty; // the conversation carries on and simply asks again
    }
    if (!parsed) return empty;

    // Untrusted input from here down.
    const doctorHint = typeof parsed.doctorHint === 'string'
        ? parsed.doctorHint.replace(SAFE_TEXT, '').replace(/\s+/g, ' ').trim().slice(0, 40) || null
        : null;

    const dateHint = DATE_HINTS.includes(parsed.dateHint) ? parsed.dateHint : null;

    const hour = Number(parsed.hourHint);
    const hourHint = Number.isInteger(hour) && hour >= 1 && hour <= 24 ? hour : null;

    const bandHint = ['morning', 'afternoon', 'evening'].includes(parsed.bandHint) ? parsed.bandHint : null;

    return { doctorHint, dateHint, hourHint, bandHint };
}

/**
 * Yes and no, without a model.
 *
 * Deterministic on purpose: "रहने दो" has to stop the flow every single time,
 * including when the model is rate-limited or having a bad day. Matched as
 * whole words so that "nahi" inside a longer sentence is not mistaken for a
 * refusal of the question that was asked.
 */
const CANCEL_WORDS = ['nahi', 'nahin', 'nai', 'rehne do', 'rahne do', 'nahi chahiye', 'cancel', 'stop', 'no', 'nope',
    'नहीं', 'नही', 'रहने दो', 'नहीं चाहिए', 'बंद करो',
    'नाही', 'नको', 'रद्द करा', 'थांबा', 'नको आहे', 'बंद करा',
    'না', 'নয়', 'বাতিল', 'থাক', 'দরকার নেই', 'বন্ধ করুন'];

const AFFIRM_WORDS = ['haan', 'han', 'ha', 'ji', 'ji haan', 'theek hai', 'thik hai', 'ok', 'okay', 'yes', 'yeah', 'yep', 'sure', 'book it', 'confirm', 'book', 'please book', 'do it', 'yup',
    'हाँ', 'हां', 'जी', 'जी हाँ', 'ठीक है', 'बिल्कुल', 'बुक करें', 'बुक करो', 'कन्फर्म करें', 'पक्का करें',
    'हो', 'होय', 'नक्की', 'हो करा',
    'হ্যাঁ', 'হ্যা', 'ঠিক আছে', 'অবশ্যই', 'করুন'];

const strip = (s) => String(s || '').toLowerCase().replace(/[.!?,।]/g, ' ').replace(/\s+/g, ' ').trim();

function shortAnswer(text, words) {
    const t = strip(text);
    if (!t || t.length > 30) return false; // a long sentence is an answer, not a simple yes/no
    return words.some(w => t === w || t.startsWith(`${w} `) || t.endsWith(` ${w}`));
}

export const isCancel = (text) => shortAnswer(text, CANCEL_WORDS);
export const isAffirm = (text) => shortAnswer(text, AFFIRM_WORDS);

/** True when the previous assistant turn was one of our own questions. */
function wasAsking(messages) {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant?.text) return false;
    return Object.values(ASK_TIME).some(q => String(lastAssistant.text).trim() === q);
}

const INSTRUCTION = `You read what a patient wants in a rural healthcare app and return structured data only.

Return ONLY a JSON object, no code fence, exactly this shape:
{"goal":"<name>","confidence":<0 to 1>,"symptoms":[],"preferredTime":null,"specialization":null}

goal must be exactly one of:
- FIND_DOCTOR — wants to see, consult, book or find a doctor
- VIEW_RECORDS — wants their records, reports, prescriptions or history
- VIEW_APPOINTMENTS — wants their existing or upcoming appointments
- FIND_MEDICINE — wants medicine, a pharmacy, or to check availability
- EMERGENCY — asking for emergency help, an ambulance, or an emergency number
- GENERAL_CARE_GUIDANCE — a health question, advice, or describing a problem with no request to go anywhere
- NONE — small talk or anything else

symptoms: what the patient SAID they are feeling, in their own words, at most 3 short entries.
  Copy their words. Never add a diagnosis, a cause, or a severity. Empty list if they described nothing.
preferredTime: one of "morning","afternoon","evening","night","today","tomorrow","soon", or null.
specialization: a medical speciality only if the patient explicitly named one, else null.

Rules:
- People speak Hindi, Marathi, Bengali and English, often mixed, and often written in Latin letters. Judge meaning, not spelling.
- Judge the goal from the patient's MOST RECENT message. Earlier messages are context only.
- Carry forward symptoms and preferredTime from earlier turns ONLY if the current goal is still FIND_DOCTOR.
- Describing a problem alone is GENERAL_CARE_GUIDANCE. "I have fever" is GENERAL_CARE_GUIDANCE.
  "I have fever, I want to see a doctor" is FIND_DOCTOR.
- If unsure, use NONE with low confidence.
- Return ONLY the JSON object. Never return a URL, a path, an endpoint, a route, code, or any explanation.`;

function parseLoose(raw) {
    const cleaned = String(raw).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try { return JSON.parse(match[0]); } catch { return null; }
    }
}

/**
 * Symptoms are the only model output that reaches the patient's ears, so they
 * are reduced to letters, digits and separators before they can be read back.
 * Anything trying to smuggle in an instruction, a path or markup dies here.
 *
 * `\p{M}` is not optional. In Devanagari and Bengali the vowel signs are
 * combining marks rather than letters, so a letters-only filter quietly turns
 * बुखार into बखर — a real word mangled into nonsense, in the sentence the
 * patient is read back about their own symptom. The zero-width joiners matter
 * for the same reason: they hold conjuncts together.
 */
const SAFE_TEXT = /[^\p{L}\p{M}\p{N} ,'‌‍-]/gu;

function cleanSymptoms(value) {
    if (!Array.isArray(value)) return [];
    return value
        .slice(0, 3)
        .map(s => String(s || '').replace(SAFE_TEXT, '').replace(/\s+/g, ' ').trim().slice(0, 40))
        .filter(s => s.length > 1);
}

/**
 * Works out where the conversation stands. Returns null for "nothing special
 * here" — which is the common case, and means the assistant answers normally.
 */
export async function deriveGuidance({ messages = [], lang = 'en', hasFiles = false, signal }) {
    const locale = TIME_LABEL[lang] ? lang : 'en';
    const latest = [...messages].reverse().find(m => m.role !== 'assistant');
    const words = String(latest?.text || '').trim();

    if (!words || hasFiles || words.length > MAX_COMMAND_CHARS) return null;

    // Checked before the model, so stopping never depends on one being available.
    if (isCancel(words) && wasAsking(messages)) {
        return { mode: 'care_guidance', goal: GUIDED, status: 'cancelled', collected: {}, missing: [], say: CANCELLED[locale], choices: [] };
    }

    let parsed;
    try {
        const recent = messages.slice(-RECENT_TURNS)
            .filter(m => m.text)
            .map(m => `${m.role === 'assistant' ? 'Assistant' : 'Patient'}: ${String(m.text).slice(0, 500)}`)
            .join('\n');

        const raw = await generateOnce({
            systemInstruction: INSTRUCTION,
            contents: [{ role: 'user', parts: [{ text: recent }] }],
            maxOutputTokens: 200,
            temperature: 0,
            responseMimeType: 'application/json',
            signal
        });
        parsed = parseLoose(raw);
    } catch {
        return null; // the patient's answer matters more than the guidance
    }
    if (!parsed) return null;

    // Everything below treats the model's reply as untrusted input.
    const goal = String(parsed.goal || '').toUpperCase();
    if (!GOALS.includes(goal)) return null;

    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) return null;

    // Single-step goals keep the existing behaviour untouched: the route comes
    // from the same allowlist it always did, and the answer streams normally.
    if (goal !== GUIDED) {
        const entry = INTENTS[goal];
        if (!entry) return { mode: 'chat', goal, status: 'chat', collected: {}, missing: [] };
        return {
            mode: 'navigate',
            goal,
            status: 'ready',
            collected: {},
            missing: [],
            route: entry.route,
            spoken: entry.spoken[entry.spoken[locale] ? locale : 'en']
        };
    }

    const symptoms = cleanSymptoms(parsed.symptoms);
    const time = TIMES.includes(parsed.preferredTime) ? parsed.preferredTime : null;
    const specialization = typeof parsed.specialization === 'string'
        ? parsed.specialization.replace(SAFE_TEXT, '').trim().slice(0, 40) || null
        : null;

    const collected = { symptoms, preferredTime: time, specialization };

    /**
     * Timing is the only thing ever asked for. Symptoms and speciality are
     * taken if offered and never demanded — pressing an unwell person for
     * detail they did not volunteer is how a helper starts sounding like a
     * form, and none of it is needed to show a list of doctors.
     *
     * A bare "yes" to the question is treated as "just show me", so answering
     * the wrong thing can never trap someone in a loop.
     */
    const asked = wasAsking(messages);
    const needsTime = false; // Let the frontend's applyHints handle time collection!

    if (needsTime) {
        return {
            mode: 'care_guidance',
            goal: GUIDED,
            status: 'collecting',
            collected,
            missing: ['preferredTime'],
            question: 'preferred_time',
            say: ASK_TIME[locale],
            choices: TIME_CHOICES[locale]
        };
    }

    return {
        mode: 'care_guidance',
        goal: GUIDED,
        status: 'ready',
        collected,
        missing: [],
        question: null,
        say: summarise({ lang: locale, symptoms, time }),
        route: INTENTS[GUIDED].route,
        choices: [],
        /**
         * What the doctor list and the booking form are allowed to know.
         *
         * Every field has already been through the validation above: the time
         * is one of TIMES, the speciality and symptom have been through
         * SAFE_TEXT, and nothing here is a route or a query string. `for` is
         * stamped on so a consumer can refuse context that was collected for a
         * different goal rather than trusting whatever is in history state.
         *
         * `specialization` is only ever what the patient named themselves.
         * Nothing infers it from a symptom — deciding that a fever means
         * "General Physician" would be a clinical judgement, and this system
         * does not make those.
         */
        context: {
            for: GUIDED,
            preferredTime: time,
            specialization,
            symptom: symptoms.join(', ') || null
        }
    };
}
