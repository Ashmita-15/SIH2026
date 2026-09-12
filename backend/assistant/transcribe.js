import { generateOnce, GeminiError } from './gemini.js';

/**
 * Speech to text.
 *
 * Deliberately one function with a swappable body: browser SpeechRecognition
 * is absent on iOS Safari and unreliable for Indian languages, and Bhashini needs an
 * account we may not have on demo day. Sending the recording to the model we
 * already call works everywhere MediaRecorder does, and handles the way rural
 * users actually speak — dialect, and Hinglish mid-sentence.
 *
 * To move to Bhashini, replace the body of transcribeAudio and keep the
 * { text, lang } contract.
 */

const LANGUAGE_NAMES = { en: 'English', hi: 'Hindi', mr: 'Marathi', bn: 'Bengali' };

const SCRIPT_OF = {
    en: 'Latin', hi: 'Devanagari', mr: 'Devanagari', bn: 'Bengali script'
};

/**
 * One instruction per language, built from the app's current setting.
 *
 * The model used to be asked to *detect* the language and was told to "trust
 * the audio" over the app setting. That made recognition the thing that chose
 * the interface language, so one mis-heard word could retranslate the whole
 * app. The user's choice is now the only input: the model is told which
 * language it is listening to and transcribes into that script.
 *
 * Verbatim in both directions — it must not translate into the target
 * language either. An English word spoken mid-sentence stays that word.
 */
function instructionFor(lang) {
    const name = LANGUAGE_NAMES[lang] || LANGUAGE_NAMES.en;
    const script = SCRIPT_OF[lang] || SCRIPT_OF.en;
    return `You transcribe short voice notes from patients in rural India.

The speaker is using ${name}. Transcribe into ${script}.

Return ONLY a JSON object, no code fence, in this exact shape:
{"text": "<what they said, word for word>"}

Rules:
- Write down exactly what was said, word for word. Do NOT translate anything.
- People mix English words into ${name}. Keep those words as they were spoken.
- If the audio is silent or unintelligible, return {"text": ""}. Never guess.
- Never answer the question, explain, or add anything the speaker did not say.`;
}

/** Models wrap JSON in fences often enough that it is not worth failing over. */
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

export async function transcribeAudio({ mimeType, data, hintLang, signal }) {
    if (!data) throw new GeminiError('bad_request', 'No audio supplied');

    // The app's language, not a hint any more. Unknown codes fall back to
    // English rather than to detection.
    const lang = LANGUAGE_NAMES[hintLang] ? hintLang : 'en';

    const raw = await generateOnce({
        systemInstruction: instructionFor(lang),
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data } }] }],
        maxOutputTokens: 800,
        temperature: 0,
        signal
    });

    const parsed = parseLoose(raw);
    /**
     * Unparseable output is discarded rather than salvaged.
     *
     * The old version returned the raw model output as the transcript, which
     * meant a stray apology or a fragment of JSON could be sent to the
     * assistant as if the patient had said it. An empty transcript makes the
     * caller ask them to repeat, which is the honest outcome.
     */
    if (!parsed || typeof parsed.text !== 'string') return { text: '', lang };

    return { text: parsed.text.trim().slice(0, 2000), lang };
}
