import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import PageLayout from '../components/PageLayout'
import { useToast } from '../components/ui/Toast'
import api from '../services/api'
import Badge from '../components/ui/Badge'
import { orderStatus } from '../lib/status'
import { useTranslation } from 'react-i18next'

export default function OrderSuccess() {
  const { t } = useTranslation()
  const toast = useToast()
  const { orderId } = useParams()
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || user.role !== 'patient') {
      navigate('/login')
      return
    }
    fetchOrder()
  }, [])

  const fetchOrder = async () => {
    try {
      setLoading(true)
      const { data } = await api.get(`/pharmacy/orders/${orderId}`)
      setOrder(data)
    } catch (error) {
      console.error('Error fetching order:', error)
      toast.error('Order not found')
      navigate('/patient')
    } finally {
      setLoading(false)
    }
  }


  if (loading) {
    return (
      <PageLayout title={t('checkout.orderSummary', 'Order Confirmation')}>
        <div className="flex justify-center items-center h-64">
          <div className="text-lg">{t('common.loading', 'Loading order details...')}</div>
        </div>
      </PageLayout>
    )
  }

  if (!order) {
    return (
      <PageLayout title={t('errors.notFoundTitle', 'Order Not Found')}>
        <div className="text-center py-12">
          <div className="text-muted text-lg mb-4">{t('pharmacy.orders.empty', 'Order not found')}</div>
          <Link to="/patient" className="btn btn-primary">{t('errors.backHome', 'Back to Dashboard')}</Link>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout title={t('status.order.confirmed')}>
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Success Message */}
        <div className="card bg-success-50 border-success-100">
          <div className="card-body text-center">
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-2xl font-bold text-success-600 mb-2">{t('status.order.confirmed')}</h2>
            <p className="text-success-600 mb-4">
              {t('booking.booked')}
            </p>
            <div className="text-lg font-semibold text-success-600">
              {t('checkout.orderSummary')}: {order.orderId}
            </div>
          </div>
        </div>

        {/* Order Details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Order Information */}
          <div className="card">
            <div className="card-body">
              <h3 className="section-title mb-4">{t('checkout.orderSummary')}</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="font-medium">{t('checkout.orderSummary')}:</span>
                  <span className="font-mono">{order.orderId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">{t('appointments.type')}:</span>
                  <Badge tone={orderStatus(order.status, t).tone}>{orderStatus(order.status, t).label}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">{t('checkout.orderType')}:</span>
                  <span className="capitalize">{order.orderType === 'delivery' ? t('checkout.delivery') : t('checkout.pickup')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">{t('appointments.requestedOn')}:</span>
                  <span>{new Date(order.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">{t('checkout.paymentMethod')}:</span>
                  <span>{t('checkout.cod')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Pharmacy Information */}
          <div className="card">
            <div className="card-body">
              <h3 className="section-title mb-4">{t('hospital.pharmacies')}</h3>
              <div className="space-y-2">
                <div className="font-semibold">{order.pharmacyId?.name}</div>
                <div className="text-small text-muted">
                  📍 {order.pharmacyId?.address || order.pharmacyId?.location}
                </div>
                <div className="text-small text-muted">
                  📞 {order.pharmacyId?.contact}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Order Items */}
        <div className="card">
          <div className="card-body">
            <h3 className="section-title mb-4">{t('pharmacy.medicines')}</h3>
            <div className="space-y-3">
              {order.items?.map((item, index) => (
                <div key={index} className="flex justify-between items-center p-3 bg-surface-2 rounded-lg">
                  <div className="flex-1">
                    <div className="font-medium">{item.medicineName}</div>
                    <div className="text-small text-muted">
                      {item.quantity} × ₹{item.finalPrice}
                    </div>
                  </div>
                  <div className="font-semibold">₹{item.total}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Billing Details */}
        <div className="card">
          <div className="card-body">
            <h3 className="section-title mb-4">{t('checkout.orderSummary')}</h3>
            <div className="space-y-2">
              <div className="flex justify-between font-semibold text-lg border-t pt-2">
                <span>{t('pharmacy.total')}:</span>
                <span>₹{order.totalAmount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Delivery/Pickup Information */}
        {order.orderType === 'delivery' && order.deliveryAddress ? (
          <div className="card">
            <div className="card-body">
              <h3 className="section-title mb-4">{t('checkout.deliveryAddress')}</h3>
              <div className="text-body">
                <div className="font-medium">{order.deliveryAddress.name}</div>
                <div>{order.deliveryAddress.phone}</div>
                <div>{order.deliveryAddress.addressLine1}</div>
                {order.deliveryAddress.addressLine2 && <div>{order.deliveryAddress.addressLine2}</div>}
                <div>{order.deliveryAddress.city}, {order.deliveryAddress.state} - {order.deliveryAddress.pincode}</div>
                {order.deliveryAddress.landmark && <div>Near {order.deliveryAddress.landmark}</div>}
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-body">
              <h3 className="section-title mb-4">{t('checkout.pickupAddress')}</h3>
              <div className="p-3 bg-warning-50 rounded-lg">
                <div className="text-warning-600 font-medium mb-2">
                  🏪 {t('checkout.collectFrom', { name: order.pharmacyId?.name || '' })}:
                </div>
                <div className="text-warning-600">
                  <div className="font-medium">{order.pharmacyId?.name}</div>
                  <div>{order.pharmacyId?.address || order.pharmacyId?.location}</div>
                  <div>📞 {order.pharmacyId?.contact}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Prescription Notice */}
        {order.prescriptionRequired && (
          <div className="card bg-warning-50 border-warning-100">
            <div className="card-body">
              <div className="flex items-start space-x-3">
                <div className="text-2xl">⚠️</div>
                <div>
                  <h4 className="font-semibold text-warning-600 mb-2">{t('pharmacy.prescriptionRequired')}</h4>
                  <p className="text-warning-600 text-small">
                    {t('checkout.prescriptionHelp')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-4 justify-center">
          <Link to="/patient" className="btn btn-primary">
            {t('errors.backHome')}
          </Link>
          <Link to="/patient/medicine" className="btn btn-secondary">
            {t('checkout.backToShop')}
          </Link>
        </div>

        {/* Contact Information */}
        <div className="card">
          <div className="card-body text-center">
            <h3 className="section-title mb-2">Need Help?</h3>
            <p className="text-muted text-small mb-4">
              If you have any questions about your order, please contact the pharmacy directly.
            </p>
            <div className="space-y-2">
              <div className="font-medium">{order.pharmacyId?.name}</div>
              <div className="text-small text-muted">📞 {order.pharmacyId?.contact}</div>
            </div>
          </div>
        </div>

      </div>
    </PageLayout>
  )
}