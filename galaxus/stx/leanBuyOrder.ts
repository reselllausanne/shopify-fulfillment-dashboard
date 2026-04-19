/** Trimmed buy-order payload for API responses (Galaxus + Decathlon StockX sync UI). */
export function leanBuyOrder(order: any) {
  if (!order) return null;
  return {
    id: order?.id ?? null,
    chainId: order?.chainId ?? null,
    orderNumber: order?.orderNumber ?? null,
    created: order?.created ?? null,
    status: order?.status ?? null,
    currentStatus: order?.currentStatus
      ? {
          key: order.currentStatus.key ?? null,
          completionStatus: order.currentStatus.completionStatus ?? null,
        }
      : null,
    estimatedDeliveryDateRange: order?.estimatedDeliveryDateRange
      ? {
          estimatedDeliveryDate: order.estimatedDeliveryDateRange.estimatedDeliveryDate ?? null,
          latestEstimatedDeliveryDate: order.estimatedDeliveryDateRange.latestEstimatedDeliveryDate ?? null,
          estimatedDeliveryStatus: order.estimatedDeliveryDateRange.estimatedDeliveryStatus ?? null,
        }
      : null,
    checkoutType: order?.checkoutType ?? null,
    shipping: order?.shipping
      ? {
          shipment: order.shipping.shipment
            ? {
                trackingUrl: order.shipping.shipment.trackingUrl ?? null,
                deliveryDate: order.shipping.shipment.deliveryDate ?? null,
              }
            : null,
        }
      : null,
    product: order?.product
      ? {
          localizedSize: order.product.localizedSize
            ? { title: order.product.localizedSize.title ?? null }
            : null,
          variant: order.product.variant
            ? {
                id: order.product.variant.id ?? null,
                product: order.product.variant.product
                  ? {
                      id: order.product.variant.product.id ?? null,
                      title: order.product.variant.product.title ?? null,
                      brand: order.product.variant.product.brand ?? null,
                      urlKey: order.product.variant.product.urlKey ?? null,
                      media: order.product.variant.product.media
                        ? {
                            thumbUrl: order.product.variant.product.media.thumbUrl ?? null,
                            imageUrl: order.product.variant.product.media.imageUrl ?? null,
                          }
                        : null,
                    }
                  : null,
              }
            : null,
        }
      : null,
    payment: order?.payment
      ? {
          settledAmount: order.payment.settledAmount
            ? {
                value: order.payment.settledAmount.value ?? null,
                currency: order.payment.settledAmount.currency ?? null,
              }
            : null,
          authorizedAmount: order.payment.authorizedAmount
            ? {
                value: order.payment.authorizedAmount.value ?? null,
                currency: order.payment.authorizedAmount.currency ?? null,
              }
            : null,
        }
      : null,
  };
}
