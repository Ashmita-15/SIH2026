import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import PageLayout from '../components/PageLayout'
import { useToast } from '../components/ui/Toast'
import api from '../services/api'
import Badge from '../components/ui/Badge'
import Card, { CardBody } from '../components/ui/Card'
import Button from '../components/ui/Button'
import { SkeletonCard } from '../components/ui/Skeleton'
import { EmptyState, ErrorState } from '../components/ui/States'
import { orderStatus, formatDate } from '../lib/status'
import { useTranslation } from 'react-i18next'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SIGNAL_URL || 'http://localhost:5000'

// ─── Status timeline step definition ──────────────────────────────────────────

function getTimelineSteps(orderType) {
  return [
    { key: 'pending', labelKey: 'checkout.timeline.pending', defaultLabel: 'Order Placed' },
    { key: 'confirmed', labelKey: 'checkout.timeline.confirmed', defaultLabel: 'Order Confirmed' },
    { key: 'preparing', labelKey: 'checkout.timeline.preparing', defaultLabel: 'Being Prepared' },
    {
      key: orderType === 'delivery' ? 'dispatched' : 'ready',
      labelKey: orderType === 'delivery' ? 'checkout.timeline.dispatched' : 'checkout.timeline.ready',
      defaultLabel: orderType === 'delivery' ? 'On the Way' : 'Ready for Pickup'
    },
    { key: 'delivered', labelKey: 'checkout.timeline.delivered', defaultLabel: 'Delivered' }
  ]
}

const STATUS_RANK = {
  pending: 1,
  confirmed: 2,
  preparing: 3,
  ready: 4,
  dispatched: 4,
  delivered: 5,
  cancelled: -1
}

export default function OrderSuccess() {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const { orderId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const user = JSON.parse(localStorage.getItem('user') || 'null')

  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)

  // Flag indicating whether the patient landed directly from completing checkout
  const isNewOrder = Boolean(location.state?.isNewOrder)

  const fetchOrder = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true)
    else setRefreshing(true)
    setLoadError(false)

    try {
      const { data } = await api.get(`/pharmacy/orders/${orderId}`)
      setOrder(data)
    } catch (error) {
      console.error('Error fetching order:', error)
      setLoadError(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [orderId])

  useEffect(() => {
    if (!user || user.role !== 'patient') {
      navigate('/login')
      return
    }
    fetchOrder()
  }, [fetchOrder, navigate, user])

  // Real-time status update subscription
  useEffect(() => {
    if (!user?.id && !user?._id) return

    const socket = io(SOCKET_URL, {
      reconnectionAttempts: 3,
      timeout: 5000
    })

    const userId = user.id || user._id
    socket.emit('join-user-room', userId)

    socket.on('order-status-updated', (data) => {
      if (data.orderId === orderId || data.orderId === order?._id) {
        toast.info(t(`status.order.${data.status}`, `Order status updated: ${data.status}`))
        fetchOrder(true)
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [orderId, order?._id, user, fetchOrder, t, toast])

  if (loading) {
    return (
      <PageLayout title={t('checkout.orderSummary', 'Order Details')}>
        <div className="max-w-3xl mx-auto space-y-4 pb-32">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </PageLayout>
    )
  }

  if (loadError || !order) {
    return (
      <PageLayout title={t('errors.notFoundTitle', 'Order Not Found')}>
        <div className="max-w-xl mx-auto py-12 pb-32">
          <Card>
            <CardBody>
              <ErrorState
                title={t('pharmacy.orders.empty', 'Order not found')}
                message={t('errors.network', 'Unable to retrieve order details. Please check your connection.')}
                onRetry={() => fetchOrder()}
                retryLabel={t('common.retry', 'Try Again')}
              />
              <div className="text-center mt-6">
                <Link to="/patient/medicine/orders" className="btn btn-secondary">
                  {t('checkout.viewOrders', 'View My Orders')}
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      </PageLayout>
    )
  }

  const statusMeta = orderStatus(order.status, t)
  const currentRank = STATUS_RANK[order.status] || 1
  const timelineSteps = getTimelineSteps(order.orderType)
  const isCancelled = order.status === 'cancelled'

  // Map statusHistory items by status for timestamps
  const historyMap = {}
  if (Array.isArray(order.statusHistory)) {
    order.statusHistory.forEach(h => {
      if (h.status && !historyMap[h.status]) {
        historyMap[h.status] = h.timestamp
      }
    })
  }

  return (
    <PageLayout
      title={isNewOrder ? t('checkout.orderPlaced', 'Order placed successfully!') : `${t('checkout.orderId', 'Order')} ${order.orderId}`}
      description={isNewOrder ? t('checkout.orderPlacedHelp', "Your medicine order has been placed. We'll keep you updated about your order status.") : undefined}
      actions={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className="btn-sm"
            onClick={() => fetchOrder(true)}
            disabled={refreshing}
          >
            {refreshing ? t('common.loading', 'Refreshing…') : t('checkout.trackOrder', 'Refresh status')}
          </Button>
          <Link to="/patient/medicine/orders" className="btn btn-ghost btn-sm">
            {t('checkout.viewOrders', 'My orders')}
          </Link>
        </div>
      }
    >
      <div className="max-w-3xl mx-auto space-y-6 pb-32 sm:pb-36">

        {/* ── 1. Order Placed Banner (if fresh checkout) ── */}
        {isNewOrder && (
          <div className="card bg-success-50 border border-success-200 shadow-sm animate-rise-in">
            <div className="card-body p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-success-600 text-white flex items-center justify-center shrink-0 text-xl font-bold shadow-sm" aria-hidden="true">
                  ✓
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-h3 font-bold text-success-900 leading-tight">
                    {order.paymentMethod === 'online' && order.paymentStatus === 'paid'
                      ? t('checkout.paymentSuccess', 'Payment successful!')
                      : t('checkout.orderPlaced', 'Order placed successfully!')}
                  </h2>
                  <p className="text-small text-success-800 mt-1">
                    {order.paymentMethod === 'online' && order.paymentStatus === 'paid'
                      ? t('checkout.paymentSuccessHelp', 'Your payment has been verified and your medicine order is confirmed.')
                      : t('checkout.orderPlacedHelp', "Your medicine order has been placed. We'll keep you updated about your order status.")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-3 text-caption font-semibold text-success-900">
                    <span className="bg-white/80 px-2.5 py-1 rounded-full border border-success-300 tabular font-mono">
                      {order.orderId}
                    </span>
                    {order.paymentMethod === 'online' && order.paymentStatus === 'paid' && (
                      <span className="bg-success-600 text-white px-2.5 py-0.5 rounded-full text-xs font-semibold">
                        ✓ {t('checkout.paid', 'Paid via Razorpay')}
                      </span>
                    )}
                    <span>·</span>
                    <span>{formatDate(order.createdAt, i18n.language)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 2. Order Header & Status Card ── */}
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-line-soft">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-caption uppercase tracking-wider font-semibold text-muted">
                    {t('checkout.orderId', 'Order ID')}
                  </span>
                  <span className="text-body font-mono font-bold text-ink">
                    {order.orderId}
                  </span>
                </div>
                <p className="text-caption text-muted mt-1">
                  {t('checkout.orderDate', 'Ordered on')}: {formatDate(order.createdAt, i18n.language)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge tone={statusMeta.tone} className="text-small px-3 py-1 font-semibold">
                  {statusMeta.label}
                </Badge>
                <span className="text-caption text-muted capitalize">
                  {order.orderType === 'delivery' ? t('checkout.delivery', 'Home delivery') : t('checkout.pickup', 'Store pickup')}
                </span>
              </div>
            </div>

            {/* ── Visual Status Timeline ── */}
            <div className="pt-6">
              <h3 className="text-small font-semibold text-ink mb-4">
                {t('checkout.timelineTitle', 'Order Progress')}
              </h3>

              {isCancelled ? (
                <div className="p-4 rounded-xl bg-danger-50 border border-danger-200 text-danger-800 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-danger-600 text-white flex items-center justify-center font-bold shrink-0">
                    ✕
                  </div>
                  <div>
                    <p className="font-semibold text-small">{t('checkout.timeline.cancelled', 'Order Cancelled')}</p>
                    <p className="text-caption text-danger-700 mt-0.5">
                      {order.statusHistory?.find(h => h.status === 'cancelled')?.note || t('status.order.cancelled', 'This order was cancelled.')}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  {/* Timeline steps */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-2">
                    {timelineSteps.map((step, idx) => {
                      const stepRank = idx + 1
                      const isCompleted = currentRank > stepRank
                      const isCurrent = currentRank === stepRank
                      const timestamp = historyMap[step.key]

                      return (
                        <div key={step.key} className="flex flex-col items-start sm:items-center text-left sm:text-center relative">
                          {/* Dot / Indicator */}
                          <div className="flex items-center justify-center mb-2">
                            {isCompleted ? (
                              <div className="w-7 h-7 rounded-full bg-success-600 text-white flex items-center justify-center text-xs font-bold shadow-sm" aria-label="Completed">
                                ✓
                              </div>
                            ) : isCurrent ? (
                              <div className="w-7 h-7 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold ring-4 ring-primary-100 shadow-sm animate-pulse" aria-label="Current">
                                {stepRank}
                              </div>
                            ) : (
                              <div className="w-7 h-7 rounded-full border-2 border-line bg-surface-2 text-muted flex items-center justify-center text-xs" aria-label="Pending">
                                {stepRank}
                              </div>
                            )}
                          </div>

                          {/* Step Label */}
                          <p className={`text-caption font-semibold leading-tight ${isCurrent ? 'text-primary-700 font-bold' : isCompleted ? 'text-ink' : 'text-muted'}`}>
                            {t(step.labelKey, step.defaultLabel)}
                          </p>

                          {/* Timestamp if available */}
                          {timestamp && (
                            <span className="text-[0.6875rem] text-muted mt-0.5 tabular">
                              {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {/* ── 3. Ordered Medicines Breakdown ── */}
        <Card>
          <CardBody>
            <h3 className="section-title mb-4 flex items-center justify-between">
              <span>{t('pharmacy.medicines', 'Medicines')}</span>
              <span className="text-caption font-normal text-muted">
                {order.items?.length || 0} {t('checkout.items', 'items')}
              </span>
            </h3>

            <div className="divide-y divide-line-soft">
              {order.items?.map((item, idx) => (
                <div key={idx} className="py-3.5 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-body font-semibold text-ink leading-snug">
                      {item.medicineName}
                    </h4>
                    <p className="text-caption text-muted mt-0.5 tabular">
                      {item.quantity} × ₹{item.finalPrice}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-body font-bold text-ink tabular">
                      ₹{item.total}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Price Calculations */}
            <div className="pt-4 mt-2 border-t border-line space-y-2 text-small">
              <div className="flex justify-between text-muted">
                <span>{t('checkout.subtotal', 'Subtotal')}</span>
                <span className="tabular font-medium text-ink">
                  ₹{order.items?.reduce((sum, item) => sum + (item.total || 0), 0) || order.totalAmount}
                </span>
              </div>
              <div className="flex justify-between text-muted">
                <span>{t('checkout.deliveryFee', 'Delivery fee')}</span>
                <span className="tabular font-medium text-ink">
                  {order.deliveryFee > 0 ? `₹${order.deliveryFee}` : <span className="text-success-600 font-semibold">{t('checkout.freeDelivery', 'Free')}</span>}
                </span>
              </div>
              <div className="flex justify-between items-center text-body font-bold text-ink pt-2 border-t border-line-soft">
                <span>{t('checkout.total', 'Total Amount')}</span>
                <span className="text-h3 font-bold text-primary-700 tabular">
                  ₹{order.totalAmount}
                </span>
              </div>
              <div className="flex justify-between items-center text-caption text-muted pt-1">
                <span>{t('checkout.paymentMethod', 'Payment method')}</span>
                <span className="font-medium text-ink inline-flex items-center gap-2">
                  {order.paymentMethod === 'online' ? (
                    <>
                      <span>{t('checkout.onlinePayment', 'Online Payment')}</span>
                      {order.paymentStatus === 'paid' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-success-100 text-success-800 dark:bg-success-950/60 dark:text-success-300">
                          ✓ {t('checkout.paid', 'Paid')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-800">
                          Pending
                        </span>
                      )}
                    </>
                  ) : (
                    <span>{t('checkout.cod', 'Cash on delivery')}</span>
                  )}
                </span>
              </div>
            </div>
          </CardBody>

        </Card>

        {/* ── 4. Delivery / Pickup Address ── */}
        <Card>
          <CardBody>
            <h3 className="section-title mb-3">
              {order.orderType === 'delivery' ? t('checkout.deliveryAddress', 'Delivery Address') : t('checkout.pickupAddress', 'Pickup Details')}
            </h3>

            {order.orderType === 'delivery' && order.deliveryAddress ? (
              <div className="text-small text-body space-y-1 bg-surface-2 p-4 rounded-xl border border-line-soft">
                <p className="font-bold text-ink text-base">{order.deliveryAddress.name}</p>
                {order.deliveryAddress.phone && (
                  <p className="text-muted tabular">
                    📞 <a href={`tel:${order.deliveryAddress.phone}`} className="hover:underline text-primary-700 font-medium">{order.deliveryAddress.phone}</a>
                  </p>
                )}
                <p className="mt-1">{order.deliveryAddress.addressLine1}</p>
                {order.deliveryAddress.addressLine2 && <p>{order.deliveryAddress.addressLine2}</p>}
                <p>
                  {order.deliveryAddress.city}, {order.deliveryAddress.state} - <span className="tabular font-medium">{order.deliveryAddress.pincode}</span>
                </p>
                {order.deliveryAddress.landmark && (
                  <p className="text-muted text-caption pt-1">Landmark: {order.deliveryAddress.landmark}</p>
                )}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-accent-50 border border-accent-200 text-small text-accent-900 space-y-1">
                <p className="font-bold text-base">
                  🏪 {order.pharmacyId?.name || t('checkout.pickup', 'Store Pickup')}
                </p>
                <p>{order.pharmacyId?.address || order.pharmacyId?.location}</p>
                {order.pharmacyId?.openingHours && (
                  <p className="text-caption text-muted pt-1">
                    Hours: {order.pharmacyId.openingHours.open} – {order.pharmacyId.openingHours.close}
                  </p>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        {/* ── 5. Pharmacy Information Card ── */}
        <Card>
          <CardBody>
            <h3 className="section-title mb-3">{t('checkout.needHelp', 'Need help with your order?')}</h3>
            <p className="text-small text-muted mb-4">
              {t('checkout.contactPharmacy', 'Contact the pharmacy directly for any questions about dispensing or delivery.')}
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-surface-2 border border-line-soft">
              <div className="min-w-0">
                <p className="font-bold text-ink">{order.pharmacyId?.name}</p>
                <p className="text-caption text-muted mt-0.5">
                  📍 {order.pharmacyId?.address || order.pharmacyId?.location}
                </p>
                {order.pharmacyId?.openingHours && (
                  <p className="text-caption text-muted mt-0.5 tabular">
                    🕒 {order.pharmacyId.openingHours.open} – {order.pharmacyId.openingHours.close}
                  </p>
                )}
              </div>

              {order.pharmacyId?.contact && (
                <div className="shrink-0">
                  <a
                    href={`tel:${order.pharmacyId.contact}`}
                    className="btn btn-primary btn-sm flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h2.2a1 1 0 011 .77l.8 3.4a1 1 0 01-.53 1.1l-1.4.7a11 11 0 006 6l.7-1.4a1 1 0 011.1-.53l3.4.8a1 1 0 01.77 1V17a2 2 0 01-2 2A16 16 0 013 5z" />
                    </svg>
                    <span>{t('pharmacy.call', 'Call')} ({order.pharmacyId.contact})</span>
                  </a>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        {/* ── 6. Bottom Navigation Actions ── */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          <Link
            to="/patient/medicine/orders"
            className="btn btn-primary w-full sm:w-auto px-6"
          >
            {t('checkout.viewOrders', 'View My Orders')}
          </Link>
          <Link
            to="/patient/medicine"
            className="btn btn-secondary w-full sm:w-auto px-6"
          >
            {t('checkout.continueShopping', 'Continue Shopping')}
          </Link>
          <Link
            to="/patient"
            className="btn btn-ghost w-full sm:w-auto px-6"
          >
            {t('errors.backHome', 'Back to Dashboard')}
          </Link>
        </div>

      </div>
    </PageLayout>
  )
}