import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import PageLayout from '../components/PageLayout'
import { useToast } from '../components/ui/Toast'
import api, { friendlyError } from '../services/api'
import { Field, Input } from '../components/ui/Field'
import Button from '../components/ui/Button'
import { compressImage } from '../lib/compressImage'
import { useTranslation } from 'react-i18next'
import { loadRazorpayScript } from '../lib/razorpay'
import { validateIndianMobile, normalizeIndianMobile } from '../lib/phoneValidation'

export default function CheckoutPage() {
  const toast = useToast()
  const { pharmacyId } = useParams()
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  
  const [cart, setCart] = useState(null)
  const [pharmacy, setPharmacy] = useState(null)
  const [loading, setLoading] = useState(true)
  const { t } = useTranslation()
  const [orderType, setOrderType] = useState('delivery')
  const [prescriptionImage, setPrescriptionImage] = useState('')
  const [attachingPrescription, setAttachingPrescription] = useState(false)
  const prescriptionInputRef = useRef(null)
  const [deliveryAddress, setDeliveryAddress] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    pincode: '',
    landmark: ''
  })
  const [notes, setNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cod') // 'cod' | 'online'
  const [submitting, setSubmitting] = useState(false)
  const [submitStep, setSubmitStep] = useState('') // '' | 'initiating' | 'verifying'
  const [paymentFailureInfo, setPaymentFailureInfo] = useState(null)
  const [phoneTouched, setPhoneTouched] = useState(false)
  const [addressErrors, setAddressErrors] = useState({})

  useEffect(() => {
    if (!user || user.role !== 'patient') {
      navigate('/login')
      return
    }
    fetchCheckoutData()
  }, [])

  const fetchCheckoutData = async () => {
    try {
      setLoading(true)
      
      // Fetch cart
      const { data: cartData } = await api.get(`/pharmacy/cart/${pharmacyId}`)
      if (!cartData || cartData.items?.length === 0) {
        toast.error('Your cart is empty!')
        navigate(`/patient/medicine/${pharmacyId}`)
        return
      }
      setCart(cartData)
      
      // Fetch pharmacy details
      const { data: pharmacyData } = await api.get(`/pharmacy/${pharmacyId}`)
      setPharmacy(pharmacyData)
      
      // Set default order type based on pharmacy delivery availability
      if (!pharmacyData.deliveryAvailable) {
        setOrderType('pickup')
      }
      
    } catch (error) {
      console.error('Error fetching checkout data:', error)
      toast.error('Error loading checkout data')
      navigate(`/patient/medicine/${pharmacyId}`)
    } finally {
      setLoading(false)
    }
  }

  const calculateDeliveryFee = () => {
    if (orderType === 'pickup') return 0
    if (!cart) return 0
    
    const subtotal = cart.totalAmount
    return subtotal < 500 ? 50 : 0 // Free delivery above ₹500
  }

  const getFinalTotal = () => {
    if (!cart) return 0
    return cart.totalAmount + calculateDeliveryFee()
  }

  const clearAddressError = (key) =>
    setAddressErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))

  const validateForm = () => {
    if (orderType !== 'delivery') return true
    const next = {}
    if (!deliveryAddress.name.trim()) next.name = 'Please enter the name for delivery.'
    
    const phoneVal = validateIndianMobile(deliveryAddress.phone)
    if (!phoneVal.isValid) {
      next.phone = phoneVal.error || 'Please enter a valid 10-digit Indian mobile number.'
    }

    if (!deliveryAddress.addressLine1.trim()) next.addressLine1 = 'Please enter the address.'
    if (!deliveryAddress.city.trim()) next.city = 'Please enter the city or village.'
    if (!deliveryAddress.state.trim()) next.state = 'Please enter the state.'
    if (!deliveryAddress.pincode.trim()) next.pincode = 'Please enter the pincode.'
    else if (!/^[0-9]{6}$/.test(deliveryAddress.pincode.trim())) next.pincode = 'A pincode is 6 digits.'
    setAddressErrors(next)
    if (Object.keys(next).length) {
      document.querySelector('[aria-invalid="true"]')?.focus()
      return false
    }
    return true
  }

  /** Compressed first: a prescription photographed on a cheap phone is 4MB. */
  const onPrescriptionPicked = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAttachingPrescription(true)
    try {
      const compressed = await compressImage(file)
      const reader = new FileReader()
      reader.onload = () => {
        setPrescriptionImage(String(reader.result))
        setAddressErrors(prev => ({ ...prev, prescription: undefined }))
      }
      reader.readAsDataURL(compressed)
    } finally {
      setAttachingPrescription(false)
    }
  }

  const placeOrder = async () => {
    if (submitting) return
    if (!validateForm()) return

    if (hasPrescriptionItems() && !prescriptionImage) {
      setAddressErrors(prev => ({ ...prev, prescription: t('checkout.prescriptionMissing') }))
      toast.error(t('checkout.prescriptionMissing'))
      return
    }

    setPaymentFailureInfo(null)

    // Prepare normalized address
    const normalizedDeliveryAddress = orderType === 'delivery' ? {
      ...deliveryAddress,
      phone: normalizeIndianMobile(deliveryAddress.phone)
    } : undefined

    // ─── Flow 1: Online Payment (Razorpay Standard Checkout) ─────────
    if (paymentMethod === 'online') {
      try {
        setSubmitting(true)
        setSubmitStep('initiating')

        // 1. Load Razorpay script dynamically
        const scriptLoaded = await loadRazorpayScript()
        if (!scriptLoaded || !window.Razorpay) {
          throw new Error('Unable to connect to Razorpay payment gateway. Please check your internet connection or use Cash on Delivery.')
        }

        // 2. Request backend to create Razorpay order (backend validates amount from DB)
        const { data: rzpData } = await api.post('/pharmacy/payment/create-order', {
          pharmacyId,
          orderType,
          deliveryAddress: normalizedDeliveryAddress,
          prescriptionImage: prescriptionImage || undefined
        })

        const { razorpayOrderId, amount, currency, keyId } = rzpData
        if (!razorpayOrderId || !keyId) {
          throw new Error('Invalid payment configuration received from server.')
        }

        // 3. Open Razorpay Checkout modal
        const rzpOptions = {
          key: keyId,
          amount: amount,
          currency: currency || 'INR',
          name: 'GramSathi Pharmacy',
          description: `Medicine Order • ${pharmacy?.name || 'GramSathi'}`,
          order_id: razorpayOrderId,
          prefill: {
            name: deliveryAddress.name || user?.name || '',
            contact: normalizeIndianMobile(deliveryAddress.phone)?.replace('+91', '') || user?.phone || '',
            email: user?.email || ''
          },
          theme: {
            color: '#0284c7'
          },
          modal: {
            ondismiss: function () {
              setSubmitting(false)
              setSubmitStep('')
              setPaymentFailureInfo({
                type: 'cancelled',
                message: t('checkout.paymentCancelledHelp', 'You closed the payment window. Your cart is safe and you can try again.')
              })
            }
          },
          handler: async function (paymentResponse) {
            try {
              setSubmitStep('verifying')

              // 4. Send HMAC-SHA256 signature to backend for mandatory server verification
              const { data: verifiedOrder } = await api.post('/pharmacy/payment/verify', {
                razorpayOrderId: paymentResponse.razorpay_order_id,
                razorpayPaymentId: paymentResponse.razorpay_payment_id,
                razorpaySignature: paymentResponse.razorpay_signature,
                pharmacyId,
                orderType,
                deliveryAddress: normalizedDeliveryAddress,
                notes,
                prescriptionImage: prescriptionImage || undefined
              })

              toast.success(t('checkout.paymentSuccess', 'Payment successful!'))
              navigate(`/patient/medicine/orders/${verifiedOrder._id}`, {
                state: { isNewOrder: true, paymentSuccess: true }
              })
            } catch (verifyError) {
              console.error('Payment verification failed:', verifyError)
              setSubmitting(false)
              setSubmitStep('')
              setPaymentFailureInfo({
                type: 'verification_failed',
                message: friendlyError(verifyError) || "We couldn't verify your payment yet. Please check your order status or try again after a moment."
              })
            }
          }
        }

        const rzp = new window.Razorpay(rzpOptions)

        rzp.on('payment.failed', function (resp) {
          console.error('[Razorpay Checkout] Payment failed:', resp.error)
          setSubmitting(false)
          setSubmitStep('')
          setPaymentFailureInfo({
            type: 'failed',
            message: resp.error?.description || t('checkout.paymentFailedHelp', 'Your payment could not be completed. Your cart has been preserved.')
          })
        })

        rzp.open()
      } catch (error) {
        console.error('Razorpay initialization error:', error)
        setSubmitting(false)
        setSubmitStep('')
        toast.error(friendlyError(error) || "We couldn't start the payment. Please try again.")
      }
      return
    }

    // ─── Flow 2: Cash on Delivery (COD) ──────────────────────────────
    try {
      setSubmitting(true)
      setSubmitStep('submitting')
      
      const orderData = {
        pharmacyId,
        orderType,
        notes
      }
      
      if (orderType === 'delivery') {
        orderData.deliveryAddress = normalizedDeliveryAddress
      }
      if (prescriptionImage) orderData.prescriptionImage = prescriptionImage
      
      const { data } = await api.post('/pharmacy/orders', orderData)
      
      // Redirect to order success page with new order indicator
      navigate(`/patient/medicine/orders/${data._id}`, { state: { isNewOrder: true } })
      
    } catch (error) {
      console.error('Order failed:', error)
      toast.error(friendlyError(error))
    } finally {
      setSubmitting(false)
      setSubmitStep('')
    }
  }

  const hasPrescriptionItems = () => {
    return cart?.items?.some(item => item.medicineId.prescriptionRequired) || false
  }


  if (loading) {
    return (
      <PageLayout title={t('checkout.orderSummary', 'Checkout')}>
        <div className="flex justify-center items-center h-64">
          <div className="text-lg">{t('checkout.loadingCheckout', 'Loading checkout...')}</div>
        </div>
      </PageLayout>
    )
  }

  if (!cart || !pharmacy) {
    return (
      <PageLayout title={t('checkout.orderSummary', 'Checkout')}>
        <div className="text-center py-12">
          <div className="text-muted text-lg">{t('checkout.loadFailed', 'Unable to load checkout data')}</div>
          <button 
            onClick={() => navigate(`/patient/medicine/${pharmacyId}`)}
            className="btn btn-primary mt-4"
          >
            {t('checkout.backToShop', 'Back to Shop')}
          </button>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout title={`${t('checkout.orderSummary', 'Checkout')} - ${pharmacy.name}`}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-32 sm:pb-36">
        
        {/* Main Checkout Form */}
        <div className="lg:col-span-2 space-y-6">

          {/* Payment Failure / Cancellation Banner */}
          {paymentFailureInfo && (
            <div className="card p-4 border-2 border-danger-200 bg-danger-50/70 dark:bg-danger-950/30 dark:border-danger-900 rounded-2xl shadow-sm animate-rise-in">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-danger-100 dark:bg-danger-900/50 text-danger-600 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-danger-900 dark:text-danger-200">
                    {paymentFailureInfo.type === 'cancelled'
                      ? t('checkout.paymentCancelled', 'Payment Cancelled')
                      : t('checkout.paymentFailed', 'Payment Unsuccessful')}
                  </h4>
                  <p className="text-small text-danger-800 dark:text-danger-300 mt-1">
                    {paymentFailureInfo.message}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentFailureInfo(null)
                        placeOrder()
                      }}
                      className="btn btn-sm btn-primary"
                    >
                      {t('checkout.tryAgain', 'Try Online Payment Again')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentMethod('cod')
                        setPaymentFailureInfo(null)
                      }}
                      className="btn btn-sm btn-secondary"
                    >
                      {t('checkout.chooseCod', 'Choose Cash on Delivery')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Order Type Selection */}
          <div className="card">
            <div className="card-body">
              <h3 className="section-title mb-4">{t('checkout.orderType', 'Order Type')}</h3>
              <div className="space-y-3">
                {pharmacy.deliveryAvailable && (
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="radio"
                      name="orderType"
                      value="delivery"
                      checked={orderType === 'delivery'}
                      onChange={e => setOrderType(e.target.value)}
                      className="w-4 h-4 text-info-600"
                    />
                    <div>
                      <div className="font-medium">{t('checkout.delivery', 'Home Delivery')}</div>
                      <div className="text-small text-muted">
                        {t('pharmacy.subtitle', 'Get medicines delivered to your address')}
                        {calculateDeliveryFee() > 0 && (
                          <span className="text-warning-600"> (+₹{calculateDeliveryFee()} delivery fee)</span>
                        )}
                      </div>
                    </div>
                  </label>
                )}
                
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="radio"
                    name="orderType"
                    value="pickup"
                    checked={orderType === 'pickup'}
                    onChange={e => setOrderType(e.target.value)}
                    className="w-4 h-4 text-info-600"
                  />
                  <div>
                    <div className="font-medium">{t('checkout.pickup', 'Store Pickup')}</div>
                    <div className="text-small text-muted">
                      {t('checkout.collectFrom', { name: pharmacy.name })}
                    </div>
                  </div>
                </label>
              </div>
              
              {orderType === 'pickup' && (
                <div className="mt-4 p-3 bg-info-50 rounded-lg">
                  <div className="text-small font-medium text-info-600 mb-1">{t('checkout.pickupAddress')}:</div>
                  <div className="text-small text-info-600">
                    {pharmacy.address || pharmacy.location}<br/>
                    📞 {pharmacy.contact}<br/>
                    ⏰ {pharmacy.openingHours?.open} - {pharmacy.openingHours?.close}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Delivery Address Form */}
          {orderType === 'delivery' && (
            <div className="card">
              <div className="card-body">
                <h3 className="section-title mb-4">{t('checkout.deliveryAddress')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label={t('checkout.fullName', 'Full name')} error={addressErrors.name} required>
                    {(props) => (
                      <Input {...props} autoComplete="name" error={addressErrors.name}
                        value={deliveryAddress.name}
                        onChange={e => { setDeliveryAddress({...deliveryAddress, name: e.target.value}); clearAddressError('name') }} />
                    )}
                  </Field>
                  <Field label={t('checkout.phone', 'Mobile number')} error={addressErrors.phone} required>
                    {(props) => {
                      const phoneVal = validateIndianMobile(deliveryAddress.phone)
                      const isPhoneValid = phoneTouched && phoneVal.isValid
                      return (
                        <div className="space-y-1">
                          <div className="flex rounded-control shadow-sm">
                            <span className="inline-flex items-center px-3 rounded-l-control border border-r-0 border-line bg-surface-2 text-muted text-small select-none font-medium">
                              +91
                            </span>
                            <Input
                              {...props}
                              type="tel"
                              inputMode="tel"
                              autoComplete="tel"
                              className="rounded-l-none"
                              error={addressErrors.phone}
                              placeholder={t('checkout.phonePlaceholder', '10-digit mobile number')}
                              maxLength="14"
                              value={deliveryAddress.phone.replace(/^\+91\s?/, '')}
                              onBlur={() => {
                                setPhoneTouched(true)
                                if (deliveryAddress.phone) {
                                  const check = validateIndianMobile(deliveryAddress.phone)
                                  if (!check.isValid) {
                                    setAddressErrors(prev => ({ ...prev, phone: check.error }))
                                  } else {
                                    clearAddressError('phone')
                                  }
                                }
                              }}
                              onChange={e => {
                                const val = e.target.value.replace(/[^\d+]/g, '')
                                setDeliveryAddress(prev => ({ ...prev, phone: val }))
                                if (phoneTouched) {
                                  const check = validateIndianMobile(val)
                                  if (check.isValid) {
                                    clearAddressError('phone')
                                  }
                                }
                              }}
                            />
                          </div>
                          {isPhoneValid && !addressErrors.phone && (
                            <p className="text-caption text-success-600 font-medium flex items-center gap-1 mt-1">
                              <span>✓</span> {t('checkout.validPhone', 'Valid Indian mobile number')}
                            </p>
                          )}
                        </div>
                      )
                    }}
                  </Field>
                  <div className="md:col-span-2">
                    <Field label={t('checkout.addressLine1', 'Address line 1')} error={addressErrors.addressLine1} required>
                      {(props) => (
                        <Input {...props} autoComplete="address-line1" error={addressErrors.addressLine1}
                          placeholder={t('checkout.addressLine1Placeholder', 'House number, street')}
                          value={deliveryAddress.addressLine1}
                          onChange={e => { setDeliveryAddress({...deliveryAddress, addressLine1: e.target.value}); clearAddressError('addressLine1') }} />
                      )}
                    </Field>
                  </div>
                  <div className="md:col-span-2">
                    <Field label={t('checkout.addressLine2', 'Address line 2')} hint={t('common.optional', 'Optional')}>
                      {(props) => (
                        <Input {...props} autoComplete="address-line2"
                          value={deliveryAddress.addressLine2}
                          onChange={e => setDeliveryAddress({...deliveryAddress, addressLine2: e.target.value})} />
                      )}
                    </Field>
                  </div>
                  <Field label={t('checkout.city', 'City or village')} error={addressErrors.city} required>
                    {(props) => (
                      <Input {...props} autoComplete="address-level2" error={addressErrors.city}
                        value={deliveryAddress.city}
                        onChange={e => { setDeliveryAddress({...deliveryAddress, city: e.target.value}); clearAddressError('city') }} />
                    )}
                  </Field>
                  <Field label={t('checkout.state', 'State')} error={addressErrors.state} required>
                    {(props) => (
                      <Input {...props} autoComplete="address-level1" error={addressErrors.state}
                        value={deliveryAddress.state}
                        onChange={e => { setDeliveryAddress({...deliveryAddress, state: e.target.value}); clearAddressError('state') }} />
                    )}
                  </Field>
                  <Field label={t('checkout.pincode', 'Pincode')} error={addressErrors.pincode} required>
                    {(props) => (
                      <Input {...props} inputMode="numeric" maxLength="6" autoComplete="postal-code" error={addressErrors.pincode}
                        placeholder={t('checkout.pincodePlaceholder', '6 digits')}
                        value={deliveryAddress.pincode}
                        onChange={e => { setDeliveryAddress({...deliveryAddress, pincode: e.target.value}); clearAddressError('pincode') }} />
                    )}
                  </Field>
                  <Field label={t('common.name', 'Landmark')} hint={t('common.optional', 'Optional')}>
                    {(props) => (
                      <Input {...props} placeholder="Near the school, temple…"
                        value={deliveryAddress.landmark}
                        onChange={e => setDeliveryAddress({...deliveryAddress, landmark: e.target.value})} />
                    )}
                  </Field>
                </div>
              </div>
            </div>
          )}

          {/* Prescription Notice */}
          {hasPrescriptionItems() && (
            <div className="card">
              <div className="card-body">
                <h4 className="card-title mb-1">{t('checkout.prescriptionTitle')}</h4>
                <p className="text-small text-body mb-4">{t('checkout.prescriptionHelp')}</p>

                {prescriptionImage ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={prescriptionImage}
                      alt={t('checkout.prescriptionTitle')}
                      className="h-20 w-20 object-cover rounded-control border border-line"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-small font-medium text-success-600">{t('checkout.prescriptionAdded')}</p>
                      <button
                        type="button"
                        className="link text-caption"
                        onClick={() => setPrescriptionImage('')}
                      >
                        {t('checkout.prescriptionReplace')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <input
                      ref={prescriptionInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="sr-only"
                      onChange={onPrescriptionPicked}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      loading={attachingPrescription}
                      onClick={() => prescriptionInputRef.current?.click()}
                    >
                      {t('checkout.prescriptionAdd')}
                    </Button>
                  </>
                )}

                {addressErrors.prescription && <p className="error-text mt-2" role="alert">{addressErrors.prescription}</p>}
              </div>
            </div>
          )}

          {/* Additional Notes */}
          <div className="card">
            <div className="card-body">
              <h3 className="section-title mb-4">Additional Notes (Optional)</h3>
              <textarea
                className="input"
                placeholder="Any special instructions or notes..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </div>

        {/* Order Summary Sidebar */}
        <div className="space-y-6">
          
          {/* Order Items */}
          <div className="card">
            <div className="card-body">
              <h3 className="section-title mb-4">{t('checkout.orderSummary')}</h3>
              <div className="space-y-3">
                {cart.items.map(item => (
                  <div key={item.medicineId._id} className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-medium text-small">{item.medicineId.medicineName}</div>
                      <div className="text-caption text-muted">
                        {item.medicineId.brand && `${item.medicineId.brand} • `}
                        Qty: {item.quantity}
                        {item.medicineId.prescriptionRequired && (
                          <span className="text-info-600 font-medium"> • {t('pharmacy.prescriptionRequired')}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-small font-medium">₹{item.finalPrice * item.quantity}</div>
                  </div>
                ))}
              </div>

              <div className="border-t pt-4 mt-4 space-y-2">
                <div className="flex justify-between">
                  <span>{t('pharmacy.total')}:</span>
                  <span>₹{cart.totalAmount}</span>
                </div>
                
                <div className="flex justify-between">
                  <span>{t('checkout.delivery')}:</span>
                  <span>
                    {calculateDeliveryFee() === 0 ? 'FREE' : `₹${calculateDeliveryFee()}`}
                  </span>
                </div>
                
                <div className="flex justify-between font-semibold text-lg border-t pt-2">
                  <span>{t('pharmacy.total')}:</span>
                  <span>₹{getFinalTotal()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div className="card">
            <div className="card-body">
              <h3 className="section-title mb-3">{t('checkout.paymentMethod')}</h3>
              <div className="space-y-3">
                {/* Cash on Delivery */}
                <label
                  className={`flex items-start gap-3 p-3.5 rounded-xl border-2 transition cursor-pointer ${
                    paymentMethod === 'cod'
                      ? 'border-emerald-600 bg-emerald-50/40 dark:border-emerald-500 dark:bg-emerald-950/20'
                      : 'border-line hover:border-line-hover bg-card'
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="cod"
                    checked={paymentMethod === 'cod'}
                    onChange={() => setPaymentMethod('cod')}
                    className="mt-1 w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-body flex items-center justify-between">
                      <span>{t('checkout.cod', 'Cash on Delivery')}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-line font-normal text-muted">Doorstep</span>
                    </div>
                    <p className="text-small text-muted mt-0.5">
                      {t('checkout.codHelp', 'Pay when your medicine arrives')}
                    </p>
                  </div>
                </label>

                {/* Online Payment (Razorpay) */}
                <label
                  className={`flex items-start gap-3 p-3.5 rounded-xl border-2 transition cursor-pointer ${
                    paymentMethod === 'online'
                      ? 'border-primary-600 bg-primary-50/40 dark:border-primary-500 dark:bg-primary-950/20'
                      : 'border-line hover:border-line-hover bg-card'
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="online"
                    checked={paymentMethod === 'online'}
                    onChange={() => setPaymentMethod('online')}
                    className="mt-1 w-4 h-4 text-primary-600 focus:ring-primary-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-body flex items-center justify-between">
                      <span>{t('checkout.onlinePayment', 'Online Payment')}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 font-medium dark:bg-primary-900/40 dark:text-primary-300">Fast & Secure</span>
                    </div>
                    <p className="text-small text-muted mt-0.5">
                      {t('checkout.onlinePaymentHelp', 'UPI, Cards, Netbanking & Wallets')}
                    </p>
                    <div className="flex items-center gap-1.5 text-caption text-muted mt-2 font-medium">
                      <svg className="w-3.5 h-3.5 text-success-600 shrink-0 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      <span>{t('checkout.poweredByRazorpay', 'Secure payment powered by Razorpay')}</span>
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Place Order / Pay Securely Button */}
          <button
            onClick={placeOrder}
            disabled={submitting}
            className={`btn btn-primary w-full text-lg py-3 flex items-center justify-center gap-2 ${submitting ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {submitting ? (
              <>
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                <span>
                  {submitStep === 'initiating'
                    ? t('checkout.initiatingPayment', 'Creating secure payment…')
                    : submitStep === 'verifying'
                    ? t('checkout.verifyingPayment', 'Verifying payment…')
                    : t('checkout.submitting', 'Placing order…')}
                </span>
              </>
            ) : paymentMethod === 'online' ? (
              <>
                <svg className="w-5 h-5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span>{t('checkout.paySecurely', { amount: getFinalTotal() })}</span>
              </>
            ) : (
              <span>{`${t('checkout.placeOrder')} — ₹${getFinalTotal()}`}</span>
            )}
          </button>

          {/* Back to Shop */}
          <button
            onClick={() => navigate(`/patient/medicine/${pharmacyId}`)}
            className="btn btn-secondary w-full"
          >
            ← {t('checkout.backToShop')}
          </button>
        </div>
      </div>
    </PageLayout>

  )
}