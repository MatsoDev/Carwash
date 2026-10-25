import { computeTotals } from './db.js';

/* Cart is intentionally pure UI state; invoices store a snapshot of every line. */
export class Cart {
  constructor() {
    this.items = [];
  }

  add({ service, price = null, size = null }) {
    const sizeId = size?.id ?? null;
    const existing = this.items.find((item) =>
      item.serviceId === service.id && (item.sizeId ?? null) === sizeId
    );
    if (existing) {
      existing.qty += 1;
      if (price != null) existing.priceSnapshot = price;
    } else {
      this.items.push({
        serviceId: service.id,
        nameSnapshot: service.name,
        priceSnapshot: price == null || price === '' ? null : Number(price),
        qty: 1,
        sizeId,
        sizeName: size?.name || ''
      });
    }
    return this.items;
  }

  inc(index) {
    if (this.items[index]) this.items[index].qty += 1;
  }

  dec(index) {
    if (!this.items[index]) return;
    this.items[index].qty -= 1;
    if (this.items[index].qty <= 0) this.items.splice(index, 1);
  }

  setQty(index, qty) {
    const n = Math.max(0, Number(qty) || 0);
    if (!this.items[index]) return;
    if (n === 0) this.items.splice(index, 1);
    else this.items[index].qty = Math.floor(n);
  }

  setPrice(index, price) {
    if (!this.items[index]) return;
    const clean = price === '' || price == null ? null : Number(price);
    this.items[index].priceSnapshot = Number.isFinite(clean) ? clean : null;
  }

  remove(index) {
    if (this.items[index]) this.items.splice(index, 1);
  }

  clear() {
    this.items = [];
  }

  get count() {
    return this.items.reduce((sum, item) => sum + item.qty, 0);
  }

  get isEmpty() {
    return this.items.length === 0;
  }

  totals(discountType = 'amount', discountValue = 0) {
    return computeTotals(this.items, discountType, discountValue);
  }

  cloneItems() {
    return this.items.map((item) => ({ ...item }));
  }
}
