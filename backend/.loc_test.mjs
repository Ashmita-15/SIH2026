import 'dotenv/config';
import mongoose from 'mongoose';
import User from './models/User.js';

const API = 'http://localhost:5001/api';
const R = [];
const ok = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, d]);
const stamp = Date.now();

const reg = async (body) => {
    const r = await fetch(`${API}/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
};
const login = async (email, password = 'password123') => {
    const r = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    return (await r.json()).token;
};

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

    // ── the manual path, which is what unblocks the reported failure ─────
    const s = await fetch(`${API}/geo/search?q=${encodeURIComponent('Civil Hospital Ludhiana Punjab')}`);
    // Post-merge contract: a ranked list. Sign-up takes the first result.
    const body = await s.json();
    const found = body?.results?.[0]
        ? { latitude: body.results[0].lat, longitude: body.results[0].lon, address: body.results[0].label }
        : {};
    ok('manual address resolves to coordinates', s.status === 200 &&
        Number.isFinite(found.latitude) && Number.isFinite(found.longitude) && found.address?.length > 10,
        `${found.latitude}, ${found.longitude}`);
    ok('coordinates are in a plausible range',
        found.latitude > 6 && found.latitude < 38 && found.longitude > 68 && found.longitude < 98,
        `${found.latitude}, ${found.longitude}`);
    ok('search returns the canonical address, not the query',
        found.address !== 'Civil Hospital Ludhiana Punjab', String(found.address).slice(0, 50));
    ok('no key or secret in the response', !JSON.stringify(found).toLowerCase().includes('key'));

    for (const [label, q, want] of [
        ['too short', 'ab', 400],
        ['blank', '', 400]
    ]) {
        const r = await fetch(`${API}/geo/search?q=${encodeURIComponent(q)}`);
        ok(`search ${label} -> ${want}`, r.status === want, String(r.status));
    }
    // No match is now an empty list, not a 404.
    const none = await fetch(`${API}/geo/search?q=zzzqqqnowhere12345`);
    const noneBody = await none.json();
    ok('search nothing matches -> 200 with empty results',
        none.status === 200 && Array.isArray(noneBody.results) && noneBody.results.length === 0,
        `${none.status} ${JSON.stringify(noneBody).slice(0, 60)}`);

    // Hospital, registered purely from a typed address (no GPS at all).
    const hEmail = `loc-hosp-${stamp}@example.com`;
    const h = await reg({
        name: 'Manual Hospital', email: hEmail, password: 'password123', role: 'hospital',
        phone: '9876543210',
        latitude: found.latitude, longitude: found.longitude, address: found.address
        // accuracy deliberately absent: a typed address has no radius
    });
    ok('hospital signup via MANUAL address succeeds', h.status === 201,
        `${h.status} ${JSON.stringify(h.body).slice(0, 80)}`);
    const hDoc = await User.findOne({ email: hEmail }).lean();
    ok('manual hospital coords saved [lon, lat]',
        hDoc?.facilityLocation?.coordinates?.[0] === found.longitude &&
        hDoc?.facilityLocation?.coordinates?.[1] === found.latitude,
        JSON.stringify(hDoc?.facilityLocation?.coordinates));
    ok('manual hospital address saved', hDoc?.facilityAddress === found.address, String(hDoc?.facilityAddress).slice(0, 40));
    ok('missing accuracy stored as undefined, not 0',
        hDoc?.facilityLocationAccuracy === undefined, String(hDoc?.facilityLocationAccuracy));

    // Pharmacy, same route.
    const pEmail = `loc-pharm-${stamp}@example.com`;
    const p = await reg({
        name: 'Manual Pharmacy', email: pEmail, password: 'password123', role: 'pharmacy',
        latitude: found.latitude, longitude: found.longitude, address: found.address
    });
    ok('pharmacy signup via MANUAL address succeeds', p.status === 201, String(p.status));
    const pDoc = await User.findOne({ email: pEmail }).lean();
    ok('manual pharmacy location saved', pDoc?.facilityLocation?.coordinates?.length === 2,
        JSON.stringify(pDoc?.facilityLocation?.coordinates));

    // ── the GPS path still works and still carries accuracy ─────────────
    const GLAT = 30.9010, GLON = 75.8573;
    const rev = await fetch(`${API}/geo/reverse?lat=${GLAT}&lon=${GLON}`);
    const revBody = await rev.json();
    ok('GPS path: reverse geocode still works', rev.status === 200 && revBody.address?.length > 10,
        String(revBody.address).slice(0, 45));

    const gEmail = `loc-gps-${stamp}@example.com`;
    const g = await reg({
        name: 'GPS Hospital', email: gEmail, password: 'password123', role: 'hospital',
        phone: '9876543210',
        latitude: GLAT, longitude: GLON, accuracy: 1200, address: revBody.address
    });
    ok('hospital signup via GPS succeeds', g.status === 201, String(g.status));
    const gDoc = await User.findOne({ email: gEmail }).lean();
    ok('GPS accuracy preserved', gDoc?.facilityLocationAccuracy === 1200, String(gDoc?.facilityLocationAccuracy));

    // ── location still mandatory overall ────────────────────────────────
    for (const [label, extra] of [
        ['neither GPS nor address', {}],
        ['address with no coords', { address: 'Civil Hospital, Ludhiana' }],
        ['coords with no address', { latitude: GLAT, longitude: GLON }],
        ['out-of-range coords', { latitude: 999, longitude: 0, address: 'X' }]
    ]) {
        const r = await reg({
            name: 'Loc Reject', email: `loc-rej-${stamp}-${Math.random()}@example.com`,
            password: 'password123', role: 'hospital', phone: '9876543210', ...extra
        });
        ok(`still refused: ${label}`, r.status === 400, `${r.status} ${r.body?.message}`);
    }
    ok('no account created for any refused case',
        (await User.countDocuments({ name: 'Loc Reject' })) === 0);

    // ── regressions ─────────────────────────────────────────────────────
    const patEmail = `loc-pat-${stamp}@example.com`;
    const pat = await reg({ name: 'Loc Patient', email: patEmail, password: 'password123', role: 'patient', age: 44, village: 'Nowhere' });
    ok('patient signup unaffected', pat.status === 201, String(pat.status));
    const patDoc = await User.findOne({ email: patEmail }).lean();
    ok('patient still has no facility location', !patDoc?.facilityLocation, JSON.stringify(patDoc?.facilityLocation));

    const docEmail = `loc-doc-${stamp}@example.com`;
    const doc = await reg({ name: 'Loc Doctor', email: docEmail, password: 'password123', role: 'doctor', specialization: 'General Medicine' });
    ok('doctor signup unaffected', doc.status === 201, String(doc.status));

    ok('new manual hospital can log in', Boolean(await login(hEmail)));
    ok('existing hospital login regression', Boolean(await login('hospital@example.com')));
    ok('existing patient login regression', Boolean(await login('ravi@example.com')));
    ok('existing health worker login regression', Boolean(await login('manjeet@gramsathi.in')));

    // ── cleanup ─────────────────────────────────────────────────────────
    const del = await User.deleteMany({ email: { $regex: `^loc-(hosp|pharm|gps|rej|pat|doc)-${stamp}` } });
    await User.deleteMany({ name: { $in: ['Manual Hospital', 'Manual Pharmacy', 'GPS Hospital', 'Loc Reject', 'Loc Patient', 'Loc Doctor'] } });
    ok('cleanup: test accounts removed',
        (await User.countDocuments({ name: { $in: ['Manual Hospital', 'GPS Hospital', 'Loc Patient'] } })) === 0,
        `deleted ${del.deletedCount}`);

    const pass = R.filter(r => r[0] === 'PASS').length;
    for (const [st, n, d] of R) console.log(`${st}  ${n}${d ? `  (${d})` : ''}`);
    console.log(`\n${pass}/${R.length} passed`);
    process.exit(pass === R.length ? 0 : 1);
};

run().catch(async (e) => {
    console.error('HARNESS ERROR', e);
    try { await User.deleteMany({ name: { $in: ['Manual Hospital', 'Manual Pharmacy', 'GPS Hospital', 'Loc Reject', 'Loc Patient', 'Loc Doctor'] } }); } catch {}
    process.exit(1);
});
