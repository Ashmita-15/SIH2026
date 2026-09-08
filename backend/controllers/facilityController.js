import Hospital from '../models/Hospital.js';
import { FACILITY_LEVELS, FACILITY_CAPABILITIES } from '../models/Hospital.js';

/**
 * Read-only views over the care network.
 *
 * Facilities are stored in the Hospital collection, which now carries a level
 * and a capability list. Nothing here writes: a facility is created and edited
 * through the existing hospital profile endpoints, and duplicating that would
 * mean two ways to change the same document.
 */

const FIELDS = 'name level capabilities parentFacilityId address phone location services operatingDays isActive';

/**
 * GET /api/facilities
 *
 * Supports the questions the referral destination picker will need to ask:
 * which facilities are of this level, which can do this, which are near here.
 *   ?level=phc
 *   ?capability=obstetrics
 *   ?near=75.85,30.90&maxKm=25
 *   ?search=rampur
 */
export const listFacilities = async (req, res) => {
    try {
        const { level, capability, near, maxKm, search, includeInactive } = req.query;
        const query = {};

        if (level) {
            if (!FACILITY_LEVELS.includes(level)) {
                return res.status(400).json({ message: `Unknown level. Expected one of: ${FACILITY_LEVELS.join(', ')}` });
            }
            query.level = level;
        }

        if (capability) {
            // Several capabilities means "can do all of these", which is what a
            // referral needs — an obstetric case that also needs an ultrasound
            // is not served by a facility that offers only one of the two.
            const wanted = String(capability).split(',').map(c => c.trim()).filter(Boolean);
            const unknown = wanted.filter(c => !FACILITY_CAPABILITIES.includes(c));
            if (unknown.length) {
                return res.status(400).json({ message: `Unknown capability: ${unknown.join(', ')}` });
            }
            query.capabilities = { $all: wanted };
        }

        if (search) {
            query.name = { $regex: String(search).trim(), $options: 'i' };
        }

        if (includeInactive !== 'true') query.isActive = true;

        if (near) {
            const [lng, lat] = String(near).split(',').map(Number);
            if (Number.isNaN(lng) || Number.isNaN(lat)) {
                return res.status(400).json({ message: 'near must be "longitude,latitude"' });
            }
            // $near sorts by distance for free, using the 2dsphere index that
            // was already on this collection.
            query.location = {
                $near: {
                    $geometry: { type: 'Point', coordinates: [lng, lat] },
                    $maxDistance: (Number(maxKm) || 50) * 1000
                }
            };
        }

        let facilities = await Hospital.find(query).select(FIELDS).lean();

        // Without a geo query there is no natural order, and an arbitrary one
        // reads as noise. Sort by tier, then by name.
        if (!near) {
            facilities.sort((a, b) => {
                const rank = FACILITY_LEVELS.indexOf(b.level) - FACILITY_LEVELS.indexOf(a.level);
                return rank !== 0 ? rank : a.name.localeCompare(b.name);
            });
        }

        res.json(facilities);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

/**
 * GET /api/facilities/tree
 *
 * The network as a hierarchy, so the referral chain is visible in one call
 * rather than reconstructed by the client one parent at a time.
 */
export const getFacilityTree = async (req, res) => {
    try {
        const all = await Hospital.find({ isActive: true }).select(FIELDS).lean();

        const byId = new Map(all.map(f => [String(f._id), { ...f, children: [] }]));
        const roots = [];

        for (const node of byId.values()) {
            const parent = node.parentFacilityId && byId.get(String(node.parentFacilityId));
            // A facility whose parent is missing or inactive still has to appear
            // somewhere, so it surfaces as a root rather than disappearing.
            if (parent) parent.children.push(node);
            else roots.push(node);
        }

        const sortByLevel = (nodes) => {
            nodes.sort((a, b) => {
                const rank = FACILITY_LEVELS.indexOf(b.level) - FACILITY_LEVELS.indexOf(a.level);
                return rank !== 0 ? rank : a.name.localeCompare(b.name);
            });
            nodes.forEach(n => sortByLevel(n.children));
            return nodes;
        };

        res.json(sortByLevel(roots));
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

/** GET /api/facilities/:id — one facility with its parent resolved. */
export const getFacilityById = async (req, res) => {
    try {
        const facility = await Hospital.findById(req.params.id)
            .select(FIELDS)
            .populate('parentFacilityId', 'name level phone address')
            .lean();

        if (!facility) return res.status(404).json({ message: 'Facility not found' });
        res.json(facility);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
};

/**
 * GET /api/facilities/meta
 * The controlled vocabularies, so no screen has to hardcode its own copy and
 * drift from the schema.
 */
export const getFacilityMeta = (req, res) => {
    res.json({ levels: FACILITY_LEVELS, capabilities: FACILITY_CAPABILITIES });
};
