import MedicineStock from '../models/MedicineStock.js';
import { badRequest } from './errors.js';

/**
 * Where a medicine can actually be got.
 *
 * The question this answers is the one that decides whether somebody spends
 * eighty rupees and three hours on a bus: is it there. Not how many boxes are
 * on the shelf — that is the pharmacy's business, and publishing it serves
 * nobody who is ill.
 *
 * So the answer is a category, and the raw count never leaves the server.
 */

export const AVAILABILITY = ['available', 'low_stock', 'unavailable'];

/**
 * Quantity in, category out.
 *
 * `minQuantity` is the pharmacy's own reorder threshold, already on the
 * record — using it means "low" means what that pharmacy thinks it means
 * rather than a number invented here.
 */
function categorise(stock) {
    if (!stock.isActive || stock.quantity <= 0) return 'unavailable';
    if (stock.quantity <= (stock.minQuantity ?? 0)) return 'low_stock';
    return 'available';
}

const escapeRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The only fields that leave the building.
 *
 * Deliberately excludes quantity, batch number, expiry and manufacturer.
 * Price stays because the shop already shows it and a patient deciding
 * whether they can afford the trip needs it.
 */
const project = (stock) => ({
    medicineName: stock.medicineName,
    genericName: stock.genericName || null,
    brand: stock.brand || null,
    dosage: stock.dosage || null,
    form: stock.form,
    prescriptionRequired: stock.prescriptionRequired,
    price: stock.price,
    availability: categorise(stock),
    pharmacy: stock.pharmacyId ? {
        _id: stock.pharmacyId._id,
        name: stock.pharmacyId.name,
        location: stock.pharmacyId.location,
        address: stock.pharmacyId.address,
        contact: stock.pharmacyId.contact,
        deliveryAvailable: stock.pharmacyId.deliveryAvailable
    } : null
});

const RANK = { available: 0, low_stock: 1, unavailable: 2 };

/**
 * Looks one medicine up across every pharmacy.
 *
 * Matched loosely on purpose. A prescription says "Amlodipine 5mg" and a shelf
 * says "Amlong 5mg (Amlodipine)"; an exact-name lookup would answer "not
 * available" for a drug that is sitting there, which is a worse failure than
 * showing one row too many.
 */
export async function findAvailability(term) {
    const name = String(term || '').trim();
    if (!name) throw badRequest('A medicine name is required');
    if (name.length < 3) throw badRequest('Give at least three letters of the medicine name');

    const pattern = new RegExp(escapeRegex(name), 'i');

    const stocks = await MedicineStock.find({
        $or: [{ medicineName: pattern }, { genericName: pattern }, { brand: pattern }]
    })
        .populate('pharmacyId', 'name location address contact deliveryAvailable isActive')
        .limit(100);

    const results = stocks
        // A pharmacy that has closed should not be offered as somewhere to go.
        .filter(s => s.pharmacyId && s.pharmacyId.isActive !== false)
        .map(project)
        .sort((a, b) => RANK[a.availability] - RANK[b.availability] ||
            a.pharmacy.name.localeCompare(b.pharmacy.name));

    return {
        query: name,
        anyAvailable: results.some(r => r.availability === 'available'),
        results
    };
}

/**
 * Several medicines at once, which is what a prescription actually is.
 *
 * Answered per medicine rather than as one merged list, because "everything
 * except the antibiotic is in stock" is the useful answer and a combined list
 * hides exactly that.
 */
export async function findAvailabilityForMany(terms) {
    const names = (Array.isArray(terms) ? terms : String(terms || '').split(','))
        .map(t => String(t).trim())
        .filter(t => t.length >= 3)
        .slice(0, 10);

    if (!names.length) throw badRequest('Give at least one medicine name of three letters or more');

    const items = [];
    for (const name of names) items.push(await findAvailability(name));
    return { items };
}

/**
 * A pharmacy's own shelf, for the pharmacy itself.
 *
 * The one place a real quantity is appropriate — it is their stock, and the
 * caller has already been checked as the owner before this is reached.
 */
export async function lowStockForPharmacy(pharmacyId) {
    const stocks = await MedicineStock.find({ pharmacyId, isActive: true })
        .select('medicineName genericName quantity minQuantity form dosage')
        .limit(500);

    const low = stocks
        .filter(s => s.quantity <= (s.minQuantity ?? 0))
        .map(s => ({
            _id: s._id,
            medicineName: s.medicineName,
            genericName: s.genericName || null,
            form: s.form,
            dosage: s.dosage || null,
            quantity: s.quantity,
            minQuantity: s.minQuantity,
            availability: s.quantity <= 0 ? 'unavailable' : 'low_stock'
        }))
        .sort((a, b) => a.quantity - b.quantity);

    return {
        outOfStock: low.filter(s => s.availability === 'unavailable').length,
        lowStock: low.filter(s => s.availability === 'low_stock').length,
        items: low
    };
}
