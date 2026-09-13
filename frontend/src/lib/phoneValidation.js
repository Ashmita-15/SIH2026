/**
 * Client-Side Indian Mobile Number Validator & Normalizer
 *
 * Rules:
 * - Exactly 10 digits
 * - First digit must be 6, 7, 8, or 9
 * - Accepts formats: "9876543210", "+919876543210", "+91 9876543210", "09876543210"
 * - Rejects: numbers < 10 digits, numbers starting with 0-5, all identical digits
 * - Normalizes to: "+919876543210"
 */

export function validateIndianMobile(phone = '') {
  if (!phone || typeof phone !== 'string') {
    return { isValid: false, normalized: '', error: 'Mobile number is required.' }
  }

  let cleaned = phone.trim().replace(/[^\d+]/g, '')

  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.slice(3)
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.slice(2)
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.slice(1)
  }

  const digitsOnly = cleaned.replace(/\D/g, '')

  if (!digitsOnly) {
    return { isValid: false, normalized: '', error: 'Please enter a mobile number.' }
  }

  if (digitsOnly.length !== 10) {
    return {
      isValid: false,
      normalized: '',
      error: 'Please enter a 10-digit mobile number.'
    }
  }

  if (!/^[6-9]/.test(digitsOnly)) {
    return {
      isValid: false,
      normalized: '',
      error: 'Indian mobile numbers must start with 6, 7, 8, or 9.'
    }
  }

  if (/^(\d)\1{9}$/.test(digitsOnly)) {
    return {
      isValid: false,
      normalized: '',
      error: 'Please enter a valid mobile number.'
    }
  }

  return {
    isValid: true,
    normalized: `+91${digitsOnly}`,
    digits: digitsOnly,
    error: null
  }
}

export function normalizeIndianMobile(phone = '') {
  const result = validateIndianMobile(phone)
  return result.isValid ? result.normalized : phone
}
