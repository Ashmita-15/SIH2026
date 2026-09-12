import { marked } from 'marked'

/**
 * Terms that mean "stop reading and get help". Matched against the
 * user's own words, not the model's, so the escalation banner does not
 * depend on the model choosing to include a warning.
 */
const RED_FLAGS = [
  // English
  'chest pain', 'chest tightness', 'can\'t breathe', 'cannot breathe', 'trouble breathing',
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
]

export function hasRedFlag(text) {
  if (!text) return false
  const lower = text.toLowerCase()
  return RED_FLAGS.some(term => lower.includes(term))
}

/**
 * `marked` passes raw HTML through by default, and its output was going
 * straight into dangerouslySetInnerHTML. Model output is shaped by user
 * input including uploaded documents, so escaping the angle brackets
 * before parsing removes the injection path entirely — markdown's own
 * syntax never needs them.
 */
export function renderMarkdownSafely(text) {
  if (!text) return ''
  const escaped = String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return marked.parse(escaped, { breaks: true, gfm: true })
}
