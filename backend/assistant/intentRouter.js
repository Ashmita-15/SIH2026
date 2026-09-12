import { generateOnce } from './gemini.js';

/**
 * Where a spoken request should take somebody.
 *
 * The model's only job here is to name one of the intents below. It never
 * produces a route, and nothing it returns is used as one: the mapping from
 * intent to screen lives in this file as a plain table, so the set of places
 * a voice command can reach is fixed at review time rather than at inference
 * time. An unrecognised answer navigates nowhere and the conversation carries
 * on as an ordinary chat.
 */

/**
 * The allowlist. `route` values are the existing patient routes — nothing new
 * is registered, and a route that is not in this table cannot be reached by
 * voice no matter what the model says.
 */
export const INTENTS = {
    FIND_DOCTOR: {
        route: '/patient/care/doctors',
        spoken: {
            en: 'Opening the list of doctors for you.',
            hi: 'डॉक्टरों की सूची खोल रहा हूँ।',
            pa: 'ਡਾਕਟਰਾਂ ਦੀ ਸੂਚੀ ਖੋਲ੍ਹ ਰਿਹਾ ਹਾਂ।',
            mr: 'तुमच्यासाठी डॉक्टरांची यादी उघडत आहे.',
            bn: 'আপনার জন্য ডাক্তারদের তালিকা খুলছি।'
        }
    },
    VIEW_RECORDS: {
        route: '/patient/records',
        spoken: {
            en: 'Opening your health records.',
            hi: 'आपके स्वास्थ्य रिकॉर्ड खोल रहा हूँ।',
            pa: 'ਤੁਹਾਡੇ ਸਿਹਤ ਰਿਕਾਰਡ ਖੋਲ੍ਹ ਰਿਹਾ ਹਾਂ।',
            mr: 'तुमचे आरोग्य रेकॉर्ड उघडत आहे.',
            bn: 'আপনার স্বাস্থ্য রেকর্ড খুলছি।'
        }
    },
    VIEW_APPOINTMENTS: {
        // Appointments live on the Care page; /patient/appointments only
        // redirects there, so the canonical route is used directly.
        route: '/patient/care',
        spoken: {
            en: 'Opening your appointments.',
            hi: 'आपकी अपॉइंटमेंट दिखा रहा हूँ।',
            pa: 'ਤੁਹਾਡੀਆਂ ਮੁਲਾਕਾਤਾਂ ਵਿਖਾ ਰਿਹਾ ਹਾਂ।',
            mr: 'तुमच्या भेटी दाखवत आहे.',
            bn: 'আপনার অ্যাপয়েন্টমেন্ট দেখাচ্ছি।'
        }
    },
    FIND_MEDICINE: {
        route: '/patient/medicine',
        spoken: {
            en: 'Opening nearby pharmacies.',
            hi: 'नज़दीकी दवा की दुकानें खोल रहा हूँ।',
            pa: 'ਨੇੜਲੀਆਂ ਦਵਾਈਆਂ ਦੀਆਂ ਦੁਕਾਨਾਂ ਖੋਲ੍ਹ ਰਿਹਾ ਹਾਂ।',
            mr: 'जवळपासची औषध दुकाने उघडत आहे.',
            bn: 'কাছাকাছি ওষুধের দোকান খুলছি।'
        }
    },
    /**
     * Someone asking for emergency help — "ambulance bulao", "emergency number".
     *
     * Separate from, and subordinate to, the red-flag engine. That one reads
     * described symptoms and fires before the model is called at all; this one
     * only recognises a request and points at the screen carrying the emergency
     * dialler. Navigation is suppressed entirely when a red flag has already
     * fired, so this can never quieten or replace it.
     */
    EMERGENCY: {
        route: '/patient',
        spoken: {
            en: 'For an emergency call 108 for an ambulance, or 112. The emergency button is on this screen.',
            hi: 'आपात स्थिति में एम्बुलेंस के लिए 108 या 112 पर कॉल करें। इस स्क्रीन पर आपातकालीन बटन है।',
            pa: 'ਐਮਰਜੈਂਸੀ ਵਿੱਚ ਐਂਬੂਲੈਂਸ ਲਈ 108 ਜਾਂ 112 ਉੱਤੇ ਕਾਲ ਕਰੋ। ਇਸ ਸਕਰੀਨ ਉੱਤੇ ਐਮਰਜੈਂਸੀ ਬਟਨ ਹੈ।',
            mr: 'आपत्कालीन परिस्थितीत रुग्णवाहिकेसाठी १०८ किंवा ११२ वर कॉल करा. या स्क्रीनवर आपत्कालीन बटण आहे.',
            bn: 'জরুরি পরিস্থিতিতে অ্যাম্বুলেন্সের জন্য ১০৮ বা ১১২ নম্বরে কল করুন। এই স্ক্রিনে জরুরি বোতাম রয়েছে।'
        }
    }
};

const INTENT_NAMES = Object.keys(INTENTS);

/**
 * Below this the request is treated as ordinary conversation.
 *
 * Set high on purpose: navigating somebody away mid-sentence when they were
 * only describing a symptom is far more disruptive than failing to navigate
 * and letting them tap.
 */
const MIN_CONFIDENCE = 0.7;

/**
 * Longer than this is a description, not a command. "Mereko do din se bukhar
 * hai, doctor ke paas jaana hai" is well under it; a paragraph about symptoms
 * is not a navigation request and should not spend a model call.
 */
const MAX_COMMAND_CHARS = 300;

const INSTRUCTION = `You classify what a patient wants to DO in a rural healthcare app.

Return ONLY a JSON object, no code fence, in this exact shape:
{"intent": "<one of the names below or NONE>", "confidence": <0 to 1>}

The only permitted intent names:
- FIND_DOCTOR — wants to see, consult, book or find a doctor
- VIEW_RECORDS — wants their medical records, reports, prescriptions or history
- VIEW_APPOINTMENTS — wants to see their existing or upcoming appointments
- FIND_MEDICINE — wants medicine, a pharmacy, or to check if a medicine is available
- EMERGENCY — is asking for emergency help, an ambulance, or an emergency number
- NONE — anything else, including describing symptoms, asking a health question,
  asking for advice, or general conversation

Rules:
- People speak Hindi, Punjabi, Marathi, Bengali and English, often mixed. Judge the meaning, not the words.
- Describing a problem is NOT a navigation request. "I have fever" is NONE.
  "I have fever, I want to see a doctor" is FIND_DOCTOR.
- If unsure, return NONE with low confidence. A wrong navigation is worse than none.
- Return ONLY the JSON object. Never return a URL, a path, an endpoint, code, or any explanation.`;

/** Models fence JSON often enough that it is not worth failing over. */
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
 * Decides whether this turn should move the app, and to where.
 *
 * Returns null far more often than not — that is the intended behaviour, and
 * every failure path returns null rather than throwing, because a navigation
 * hint failing must never cost the patient their answer.
 */
export async function detectNavigation({ text, lang = 'en', hasFiles = false, signal }) {
    const words = String(text || '').trim();

    // A photo of a prescription is a question about the photo, not a command.
    if (!words || hasFiles || words.length > MAX_COMMAND_CHARS) return null;

    let parsed;
    try {
        const raw = await generateOnce({
            systemInstruction: INSTRUCTION,
            contents: [{ role: 'user', parts: [{ text: words }] }],
            maxOutputTokens: 60,
            temperature: 0,
            responseMimeType: 'application/json',
            signal
        });
        parsed = parseLoose(raw);
    } catch {
        // Quota, network, anything: the chat answer still matters more.
        return null;
    }

    if (!parsed) return null;

    /**
     * The gate. Whatever the model returned is treated as an untrusted string
     * and only accepted if it is one of the names declared above; the route is
     * then read from this file's table, never from the response.
     */
    const name = String(parsed.intent || '').toUpperCase();
    if (!INTENT_NAMES.includes(name)) return null;

    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) return null;

    const entry = INTENTS[name];
    const locale = entry.spoken[lang] ? lang : 'en';

    return {
        intent: name,
        route: entry.route,
        spoken: entry.spoken[locale],
        confidence
    };
}
