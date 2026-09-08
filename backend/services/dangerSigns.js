/**
 * Deterministic danger-sign detection for a set of vitals.
 *
 * Same principle as assistant/redFlags.js, applied to numbers instead of
 * words: escalation is decided by a rule, never by a model. A model that is
 * having an off day must not be the reason a blood pressure of 180/120 goes
 * unremarked, and a threshold nobody can point at in a guideline is a
 * threshold nobody can defend afterwards.
 *
 * What this file answers is narrow on purpose: "did a predefined danger sign
 * appear?" It does not name a condition, choose a treatment, or decide what
 * happens next. Those belong to a clinician.
 */

/**
 * Each rule is one comparison against a published cut-off.
 *
 *   code     stored on the encounter — stable, translatable at display time
 *   label    English text for the interface only; never written to the record
 *   severity 'critical' means see someone now, 'warning' means do not ignore
 *   basis    the reason this number and not another, kept next to the rule
 *            so it can be answered when someone asks
 */
export const DANGER_RULES = [
    {
        code: 'severe_hypertension',
        label: 'Very high blood pressure',
        severity: 'critical',
        basis: 'Systolic ≥160 or diastolic ≥110 — the standard severe-hypertension cut-off and the antenatal referral trigger',
        test: (v) => (v.systolic >= 160) || (v.diastolic >= 110)
    },
    {
        code: 'raised_blood_pressure',
        label: 'Raised blood pressure',
        severity: 'warning',
        basis: 'Systolic ≥140 or diastolic ≥90 — the standard raised-BP cut-off',
        // Only when it is not already the severe case, so one reading does not
        // report two overlapping signs.
        test: (v) => ((v.systolic >= 140) || (v.diastolic >= 90)) && !(v.systolic >= 160 || v.diastolic >= 110)
    },
    {
        code: 'severe_hypoxia',
        label: 'Very low oxygen',
        severity: 'critical',
        basis: 'SpO2 below 90% — widely used emergency threshold',
        test: (v) => v.spo2 < 90
    },
    {
        code: 'low_oxygen',
        label: 'Low oxygen',
        severity: 'warning',
        basis: 'SpO2 90–93%, below the normal floor of 94%',
        test: (v) => v.spo2 >= 90 && v.spo2 < 94
    },
    {
        code: 'high_fever',
        label: 'High fever',
        severity: 'warning',
        basis: 'Temperature 39.0°C or above — high-grade fever',
        test: (v) => v.temperature >= 39
    },
    {
        code: 'hypothermia',
        label: 'Body temperature too low',
        severity: 'critical',
        basis: 'Temperature below 35.0°C — the standard definition of hypothermia',
        test: (v) => v.temperature < 35
    },
    {
        code: 'hypoglycaemia',
        label: 'Very low blood sugar',
        severity: 'critical',
        basis: 'Blood glucose below 70 mg/dL',
        test: (v) => v.bloodSugar < 70
    },
    {
        code: 'very_high_glucose',
        label: 'Very high blood sugar',
        severity: 'warning',
        basis: 'Blood glucose 300 mg/dL or above — marked hyperglycaemia',
        test: (v) => v.bloodSugar >= 300
    },
    {
        code: 'severe_anaemia',
        label: 'Severe anaemia',
        severity: 'critical',
        basis: 'Haemoglobin below 7 g/dL — the severe-anaemia referral threshold',
        test: (v) => v.hemoglobin < 7
    },
    {
        code: 'fast_pulse',
        label: 'Fast pulse',
        severity: 'warning',
        basis: 'Pulse above 120 beats per minute',
        test: (v) => v.pulse > 120
    }
];

/**
 * Runs every rule over whatever was actually measured.
 *
 * A rule only runs on a reading that exists. A health worker without a pulse
 * oximeter leaves SpO2 empty, and an absent number must never be read as a
 * normal one — treating a missing value as fine is how a reassuring record
 * gets written about somebody nobody measured.
 */
export function detectDangerSigns(vitals = {}) {
    const present = {};
    for (const [key, value] of Object.entries(vitals)) {
        if (typeof value === 'number' && Number.isFinite(value)) present[key] = value;
    }

    return DANGER_RULES.filter(rule => {
        try {
            // A comparison against undefined is false in JavaScript, which is
            // the behaviour wanted here, but each rule is still guarded so one
            // bad reading cannot take the whole visit down.
            return rule.test(present) === true;
        } catch {
            return false;
        }
    });
}

/** The codes, which is all the encounter stores. */
export function dangerSignCodes(vitals) {
    return detectDangerSigns(vitals).map(r => r.code);
}

/**
 * The one sentence the worker is shown.
 *
 * Deliberately says only that something was found and who should look at it.
 * It names no condition and recommends no treatment, because a health worker
 * acting on a guess from an app is the failure this whole design is built to
 * avoid.
 */
export function dangerSummary(signs) {
    if (!signs.length) return null;
    const critical = signs.some(s => s.severity === 'critical');
    return {
        severity: critical ? 'critical' : 'warning',
        message: critical
            ? 'Danger sign detected — this person needs to be seen urgently. Contact the PHC medical officer now.'
            : 'Danger sign detected — clinical review recommended.'
    };
}

/** The rule catalogue, so no screen keeps its own copy of the thresholds. */
export function dangerRuleCatalogue() {
    return DANGER_RULES.map(({ code, label, severity, basis }) => ({ code, label, severity, basis }));
}
