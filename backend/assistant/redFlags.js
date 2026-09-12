/**
 * Server-side copy of the escalation terms. The client keeps its own copy
 * for an instant banner, but the server is the authority: voice input is
 * transcribed here, so a spoken "सीने में दर्द" would otherwise never meet
 * a red-flag check at all.
 *
 * Matched against the patient's own words — never the model's — so
 * escalation does not depend on the model choosing to warn.
 */
const RED_FLAGS = [
    // English
    'chest pain', 'chest tightness', "can't breathe", 'cannot breathe', 'trouble breathing',
    'difficulty breathing', 'breathless', 'unconscious', 'fainted', 'seizure', 'fitting',
    'severe bleeding', 'heavy bleeding', 'bleeding heavily', 'coughing blood', 'vomiting blood',
    'blood in stool', 'stroke', 'slurred speech', 'face drooping', 'paralysis', 'numb on one side',
    'suicidal', 'kill myself', 'end my life', 'overdose', 'poisoned', 'snake bite', 'snakebite',
    'severe burn', 'not moving', 'no pulse', 'blue lips', 'stiff neck', 'convulsion',
    // Hindi
    'सीने में दर्द', 'छाती में दर्द', 'साँस नहीं', 'सांस नहीं', 'साँस लेने में', 'बेहोश',
    'दौरा', 'खून बह', 'खून आ', 'लकवा', 'जहर', 'ज़हर', 'साँप ने काटा', 'सांप ने काटा',
    // Marathi
    'छातीत दुखणे', 'छातीत दुखत', 'छातीत वेदना', 'छातीत तीव्र वेदना', 'छातीत खूप दुखणे', 'छातीत कळ', 'श्वास घेता येत नाही', 'श्वास घेण्यास त्रास', 'दम लागणे', 'बेशुद्ध',
    'चक्कर येऊन पडणे', 'झटका', 'आकडी', 'रक्तस्त्राव', 'खूप रक्त वाहणे', 'रक्ताची उलटी',
    'पक्षाघात', 'अर्धांगवायू', 'विष', 'सर्पदंश', 'साप चावला',
    // Bengali
    'বুকে ব্যথা', 'বুকে তীব্র ব্যথা', 'বুকে ভীষণ ব্যথা', 'বুকে চাপ', 'শ্বাস নিতে পারছি না', 'শ্বাসকষ্ট', 'নিঃশ্বাস নিতে কষ্ট', 'অজ্ঞান',
    'মৃগীর খিঁচুনি', 'খিঁচুনি', 'প্রচুর রক্তপাত', 'রক্তবমি', 'প্যারালাইসিস', 'অসাড়',
    'বিষ', 'সাপে কেটেছে', 'সাপের কামড়'
];

export function hasRedFlag(text) {
    if (!text) return false;
    const lower = String(text).toLowerCase();
    return RED_FLAGS.some(term => lower.includes(term));
}

/** The spoken escalation line, so a user who cannot read still hears it. */
export const ESCALATION_SPOKEN = {
    en: 'What you have described can be serious. Please call one zero eight for an ambulance, or see a doctor now.',
    hi: 'आपने जो बताया है वह गंभीर हो सकता है। कृपया अभी 108 पर एम्बुलेंस बुलाएँ या डॉक्टर को दिखाएँ।',
    mr: 'तुम्ही सांगितलेली लक्षणे गंभीर असू शकतात. कृपया त्वरित रुग्णवाहिकेसाठी १०८ वर कॉल करा किंवा डॉक्टरांना भेटा.',
    bn: 'আপনি যা বর্ণনা করেছেন তা গুরুতর হতে পারে। অনুগ্রহ করে এখনই অ্যাম্বুলেন্সের জন্য ১০৮ নম্বরে কল করুন বা ডাক্তারের সাথে দেখা করুন।'
};
