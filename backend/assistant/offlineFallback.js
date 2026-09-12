/**
 * The answer of last resort.
 *
 * Grown from the keyword matcher that used to live in symptomCheckerController
 * and was never wired to anything. It is not a model and does not pretend to
 * be: when the network or the model is unavailable, a handful of correct,
 * pre-written first-aid answers beats an error message — which is the whole
 * of the offline story we should claim.
 */
const RULES = [
    {
        match: ['fever', 'बुखार', 'temperature', 'ताप', 'ज्वर', 'জ্বর'],
        en: 'Rest and drink plenty of fluids — water, ORS or coconut water. A cool damp cloth on the forehead helps. See a doctor if the fever lasts more than three days, goes above 39C, or comes with a stiff neck, rash or difficulty breathing.',
        hi: 'आराम करें और खूब तरल पिएं — पानी, ओआरएस या नारियल पानी। माथे पर ठंडी गीली पट्टी रखें। अगर बुखार तीन दिन से ज़्यादा रहे, बहुत तेज़ हो, या गर्दन में अकड़न, दाने या साँस लेने में तकलीफ़ हो तो डॉक्टर को दिखाएँ।',
        mr: 'विश्रांती घ्या आणि भरपूर द्रवपदार्थ प्या — पाणी, ओआरएस किंवा नारळ पाणी. कपाळावर थंड पाण्याची पट्टी ठेवा. ताप तीन दिवसांपेक्षा जास्त राहिल्यास किंवा श्वास घेण्यास त्रास झाल्यास त्वरित डॉक्टरांना भेटा.',
        bn: 'বিশ্রাম নিন এবং প্রচুর তরল পান করুন — জল, ওআরএস বা ডাবের জল। কপালে ঠান্ডা ভেজা কাপড়ের পট্টি দিন। জ্বর তিন দিনের বেশি থাকলে বা শ্বাসকষ্ট হলে অবিলম্বে ডাক্তার দেখান।'
    },
    {
        match: ['diarrhea', 'diarrhoea', 'loose motion', 'दस्त', 'पतले दस्त', 'vomit', 'उल्टी', 'जुलाब', 'उलटी', 'पातळ संडास', 'ডায়রিয়া', 'বমি', 'পাতলা পায়খানা'],
        en: 'Give ORS after every loose stool. No sachet? Mix six level teaspoons of sugar and half a teaspoon of salt in one litre of clean water. Keep eating normally. Go to a clinic urgently if there is blood in the stool, no urine for eight hours, sunken eyes, or the person cannot keep any fluid down.',
        hi: 'हर पतले दस्त के बाद ओआरएस दें। पैकेट न हो तो एक लीटर साफ़ पानी में छह चम्मच चीनी और आधा चम्मच नमक मिलाएँ। खाना सामान्य रूप से जारी रखें। दस्त में खून आए, आठ घंटे पेशाब न हो, आँखें धँसी हों, या कुछ भी पेट में न रुके तो तुरंत क्लीनिक जाएँ।',
        mr: 'प्रत्येक पातळ शौचानंतर ओआरएस द्या. पाकीट नसल्यास एक लिटर स्वच्छ पाण्यात सहा चमचे साखर आणि अर्धा चमचा मीठ मिसळा. नेहमीप्रमाणे जेवण चालू ठेवा. विष्ठेत रक्त आल्यास किंवा आठ तास लघवी न झाल्यास त्वरित दवाखान्यात जा.',
        bn: 'প্রতিবার পাতলা পায়খানার পর ওআরএস দিন। ওআরএস না থাকলে এক লিটার পরিষ্কার জলে ছয় চামচ চিনি এবং আধ চামচ নুন মিশিয়ে নিন। স্বাভাবিক খাওয়া চালিয়ে যান। মলে রক্ত এলে বা আট ঘণ্টা প্রস্রাব না হলে জরুরিভাবে ক্লিনিকে যান।'
    },
    {
        match: ['burn', 'जल गया', 'जल गयी', 'जलन', 'भाजले', 'भाजल्यास', 'पुड़े', 'পোড়া'],
        en: 'Cool the burn under clean running water for 20 minutes. Do not put ice, toothpaste, oil, butter or ash on it. Cover loosely with a clean cloth. Go to hospital if the burn is bigger than the palm, on the face, hands or genitals, or looks white or charred.',
        hi: 'जले हुए हिस्से को 20 मिनट तक साफ़ बहते पानी के नीचे रखें। बर्फ़, टूथपेस्ट, तेल, मक्खन या राख न लगाएँ। साफ़ कपड़े से ढीला ढक दें। अगर जला हिस्सा हथेली से बड़ा हो, चेहरे या हाथों पर हो, या सफ़ेद दिखे तो अस्पताल जाएँ।',
        mr: 'भाजलेला भाग २० मिनिटे स्वच्छ वाहत्या पाण्याखाली ठेवा. बर्फ, टूथपेस्ट, तेल, लोणी किंवा राख लावू नका. स्वच्छ कापडाने सैल झाका. भाजलेला भाग तळहातापेक्षा मोठा असल्यास किंवा चेहऱ्यावर असल्यास त्वरित रुग्णालयात जा.',
        bn: 'পোড়া অংশটি ২০ মিনিট পরিষ্কার ঠান্ডা জলের ধারায় রাখুন। বরফ, টুথপেস্ট, তেল, মাখন বা ছাই লাগাবেন না। পরিষ্কার কাপড় দিয়ে আলগাভাবে ঢেকে দিন। পোড়া অংশ হাতের তালুর চেয়ে বড় হলে হাসপাতালে যান।'
    },
    {
        match: ['snake', 'साँप', 'सांप', 'साप', 'सर्प', 'সাপ'],
        en: 'Snake bite is an emergency — call 108 now. Keep the person still and the bitten limb below heart level. Remove rings and bangles. Do NOT cut the wound, suck the venom, apply a tourniquet or use any traditional remedy.',
        hi: 'साँप का काटना आपात स्थिति है — अभी 108 पर कॉल करें। व्यक्ति को शांत और स्थिर रखें, काटा हुआ अंग दिल से नीचे रखें। अंगूठी और चूड़ियाँ उतार दें। घाव को काटें नहीं, ज़हर चूसें नहीं, कसकर बाँधें नहीं।',
        mr: 'सर्पदंश ही एक आणीबाणी आहे — त्वरित १०८ वर कॉल करा. व्यक्तीला शांत आणि स्थिर ठेवा. चावलेला अवयव हृदयाच्या पातळीपेक्षा खाली ठेवा. अंगठ्या किंवा बांगड्या काढून टाका. जखमेवर चीरा मारू नका, विष चोखू नका.',
        bn: 'সাপের কামড় একটি জরুরি অবস্থা — এখনই ১০৮ নম্বরে কল করুন। রোগীকে স্থির রাখুন এবং আক্রান্ত অঙ্গ হৃদপিণ্ডের নিচের স্তরে রাখুন। আংটি বা চুড়ি খুলে ফেলুন। ক্ষতস্থান কাটবেন না, বিষ চুষবেন না, শক্ত করে বাঁধবেন না।'
    }
];

const FALLBACK = {
    en: 'I cannot reach the assistant right now. If this is urgent, call 108 for an ambulance or 104 for the health helpline. Otherwise please try again when you have a signal, or book a doctor.',
    hi: 'मैं अभी सहायक तक नहीं पहुँच पा रहा। अगर यह ज़रूरी है तो 108 पर एम्बुलेंस या 104 पर स्वास्थ्य हेल्पलाइन को कॉल करें। नहीं तो नेटवर्क आने पर फिर कोशिश करें, या डॉक्टर से समय लें।',
    mr: 'मी सध्या सहाय्यकापर्यंत पोहोचू शकत नाही. हे तातडीचे असल्यास रुग्णवाहिकेसाठी १०८ किंवा आरोग्य हेल्पलाइनसाठी १०४ वर कॉल करा. अन्यथा नेटवर्क आल्यावर पुन्हा प्रयत्न करा किंवा डॉक्टरची भेट बुक करा.',
    bn: 'আমি এই মুহূর্তে সহকারীর সাথে যোগাযোগ করতে পারছি না। এটি জরুরি হলে অ্যাম্বুলেন্সের জন্য ১০৮ বা স্বাস্থ্য হেল্পলাইনের জন্য ১০৪ নম্বরে কল করুন। অথবা সিগন্যাল পেলে আবার চেষ্টা করুন।'
};

export function offlineAnswer(text, lang = 'en') {
    const locale = ['en', 'hi', 'mr', 'bn'].includes(lang) ? lang : 'en';
    const lower = String(text || '').toLowerCase();
    const rule = RULES.find(r => r.match.some(k => lower.includes(k)));
    return { text: rule ? rule[locale] : FALLBACK[locale], offline: true, matched: Boolean(rule) };
}

/** Shipped to the client so it can answer with no network at all. */
export function offlinePack(lang = 'en') {
    const locale = ['en', 'hi', 'mr', 'bn'].includes(lang) ? lang : 'en';
    return {
        fallback: FALLBACK[locale],
        rules: RULES.map(r => ({ match: r.match, text: r[locale] }))
    };
}
