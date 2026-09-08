import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import connectDB from './config/db.js';
import User from './models/User.js';
import Hospital from './models/Hospital.js';
import Pharmacy from './models/Pharmacy.js';
import MedicineStock from './models/MedicineStock.js';

dotenv.config();

const run = async () => {
    await connectDB();
    await User.deleteMany({});
    await Hospital.deleteMany({});
    await Pharmacy.deleteMany({});
    await MedicineStock.deleteMany({});

    /**
     * Reconcile indexes with the schemas before inserting anything.
     *
     * deleteMany drops documents but never indexes, so an index left behind by
     * an older version of a schema survives every reseed. The hospitals
     * collection carried a unique index on a `gmail` field that no longer
     * exists; since no document has that field they all indexed as null, and a
     * non-sparse unique index treats those nulls as duplicates — which quietly
     * capped the collection at exactly one hospital. It never showed up while
     * the seed created a single hospital, and broke the moment it created a
     * network.
     *
     * syncIndexes drops what the schema no longer declares and builds what it
     * does, so this cannot recur as models are added.
     */
    for (const model of [User, Hospital, Pharmacy, MedicineStock]) {
        const dropped = await model.syncIndexes();
        if (dropped?.length) console.log(`Dropped stale ${model.modelName} indexes:`, dropped.join(', '));
    }

    const pw = await bcrypt.hash('password123', 10);

    // Create users
    const patient = await User.create({ 
        name: 'Ravi Kumar', 
        email: 'ravi@example.com', 
        passwordHash: pw, 
        role: 'patient', 
        age: 35, 
        village: 'Sundarpur',
        phone: '+91-9876543210'
    });
    
    const doctor = await User.create({ 
        name: 'Dr. Meera Sharma', 
        email: 'meera@example.com', 
        passwordHash: pw, 
        role: 'doctor', 
        specialization: 'General Medicine', 
        qualification: 'MBBS', 
        availability: '9am-1pm' 
    });
    
    const pharmacyOwner = await User.create({ 
        name: 'Rajesh Pharmacy Owner', 
        email: 'rajesh@pharmacy.com', 
        passwordHash: pw, 
        role: 'pharmacy',
        phone: '+91-9999999999'
    });

    // Create second pharmacy owner
    const pharmacyOwner2 = await User.create({ 
        name: 'Suresh Pharmacy Owner', 
        email: 'suresh@pharmacy.com', 
        passwordHash: pw, 
        role: 'pharmacy',
        phone: '+91-8888888888'
    });

    // Create hospital user
    const hospitalUser = await User.create({ 
        name: 'Apollo Hospital Admin', 
        email: 'hospital@example.com', 
        passwordHash: pw, 
        role: 'hospital',
        phone: '+91-7777777777'
    });

    // Create first pharmacy (not associated with hospital)
    const pharmacy1 = await Pharmacy.create({ 
        name: 'Gram Pharmacy & Medical Store', 
        location: 'Sundarpur', 
        address: 'Main Bazaar, Sundarpur Village, District Ludhiana, Punjab - 141001',
        contact: '+91-9999999999',
        email: 'gram.pharmacy@example.com',
        description: 'Your trusted neighborhood pharmacy providing quality medicines at affordable prices. We stock all essential medicines and provide home delivery within 5km radius.',
        deliveryAvailable: true,
        deliveryRadius: 5,
        openingHours: { open: '08:00', close: '22:00' },
        ownerId: pharmacyOwner._id
    });

    // Create second pharmacy (to be associated with hospital)
    const pharmacy2 = await Pharmacy.create({ 
        name: 'Apollo Hospital Pharmacy', 
        location: 'Apollo Hospital Campus', 
        address: 'Apollo Hospital, Main Road, Sundarpur, District Ludhiana, Punjab - 141001',
        contact: '+91-8888888888',
        email: 'apollo.pharmacy@example.com',
        description: 'Pharmacy located inside Apollo Hospital, providing medicines for in-patients and out-patients.',
        deliveryAvailable: true,
        deliveryRadius: 3,
        openingHours: { open: '00:00', close: '23:59' }, // 24/7
        ownerId: pharmacyOwner2._id
    });

    // Create hospital
    const hospital = await Hospital.create({ 
        name: 'Apollo Hospital', 
        email: 'hospital@example.com', 
        phone: '+91-7777777777',
        location: {
            type: 'Point',
            coordinates: [75.85133, 30.90096] // Example coordinates
        },
        address: 'Main Road, Sundarpur, District Ludhiana, Punjab - 141001',
        description: 'Multi-specialty hospital providing comprehensive healthcare services to the community.',
        contactPerson: 'Dr. Vikram Sharma',
        website: 'https://www.apollohospitals.com',
        services: ['General Medicine', 'Pediatrics', 'Obstetrics & Gynecology', 'Orthopedics', 'Dermatology'],
        ownerId: hospitalUser._id,
        // Associate the second pharmacy with the hospital
        pharmacies: [pharmacy2._id]
    });

    // Update hospital user with hospitalId
    await User.findByIdAndUpdate(hospitalUser._id, { hospitalId: hospital._id });

    // Update doctors to be associated with hospital
    await User.updateMany(
        { role: 'doctor' },
        { $set: { hospitalId: hospital._id } }
    );

    // Add doctors to hospital
    hospital.doctors = [doctor._id];
    await hospital.save();

    // Create sample medicines with detailed information
    const medicines = [
        {
            medicineName: 'Paracetamol 500mg',
            genericName: 'Paracetamol',
            brand: 'Crocin',
            category: 'General',
            dosage: '500mg',
            form: 'Tablet',
            price: 25,
            mrp: 30,
            discount: 16.67,
            quantity: 100,
            minQuantity: 10,
            manufacturer: 'GSK Pharmaceuticals',
            prescriptionRequired: false,
            description: 'Pain relief and fever reducer. Safe for adults and children above 6 years.',
            expiryDate: new Date('2026-12-31')
        },
        {
            medicineName: 'ORS Powder',
            genericName: 'Oral Rehydration Salts',
            brand: 'Electral',
            category: 'General',
            dosage: '21.8g',
            form: 'Powder',
            price: 15,
            mrp: 18,
            discount: 16.67,
            quantity: 200,
            minQuantity: 20,
            manufacturer: 'FDC Limited',
            prescriptionRequired: false,
              description: 'For treatment of dehydration due to diarrhea and vomiting.',
              expiryDate: new Date('2025-08-30')
        },
        // Add more medicines to first pharmacy
        {
            medicineName: 'Amoxicillin 250mg',
            genericName: 'Amoxicillin',
            brand: 'Novamox',
            category: 'Prescription',
            dosage: '250mg',
            form: 'Capsule',
            price: 45,
            mrp: 52,
            discount: 13.46,
            quantity: 50,
            minQuantity: 5,
            manufacturer: 'Cipla Ltd',
            prescriptionRequired: true,
            description: 'Antibiotic for bacterial infections. Complete the full course as prescribed.',
            expiryDate: new Date('2025-10-15')
        },
        {
            medicineName: 'Cetirizine 10mg',
            genericName: 'Cetirizine Hydrochloride',
            brand: 'Zyrtec',
            category: 'General',
            dosage: '10mg',
            form: 'Tablet',
            price: 18,
            mrp: 22,
            discount: 18.18,
            quantity: 80,
            minQuantity: 8,
            manufacturer: 'Dr. Reddy\'s Labs',
            prescriptionRequired: false,
            description: 'Antihistamine for allergy relief. Non-drowsy formula.',
            expiryDate: new Date('2025-06-20')
        },
        {
            medicineName: 'Vitamin D3 60000 IU',
            genericName: 'Cholecalciferol',
            brand: 'Uprise-D3',
            category: 'Vitamins',
            dosage: '60000 IU',
            form: 'Capsule',
            price: 35,
            mrp: 42,
            discount: 16.67,
            quantity: 30,
            minQuantity: 3,
            manufacturer: 'Alkem Laboratories',
            prescriptionRequired: false,
            description: 'High strength Vitamin D3 supplement for bone health.',
            expiryDate: new Date('2026-02-28')
        },
        {
            medicineName: 'Cough Syrup 100ml',
            genericName: 'Dextromethorphan + Chlorpheniramine',
            brand: 'Benadryl DR',
            category: 'General',
            dosage: '100ml',
            form: 'Syrup',
            price: 65,
            mrp: 75,
            discount: 13.33,
            quantity: 25,
            minQuantity: 3,
            manufacturer: 'Johnson & Johnson',
            prescriptionRequired: false,
            description: 'Relief from dry cough and throat irritation.',
            expiryDate: new Date('2025-09-12')
        },
        {
            medicineName: 'Aspirin 75mg',
            genericName: 'Acetylsalicylic Acid',
            brand: 'Ecosprin',
            category: 'Prescription',
            dosage: '75mg',
            form: 'Tablet',
            price: 12,
            mrp: 15,
            discount: 20,
            quantity: 0, // Out of stock
            minQuantity: 10,
            manufacturer: 'USV Ltd',
            prescriptionRequired: true,
            description: 'Low dose aspirin for cardiovascular protection.',
            expiryDate: new Date('2025-11-30')
        },
        {
            medicineName: 'Antacid Tablets',
            genericName: 'Magnesium Hydroxide + Aluminum Hydroxide',
            brand: 'ENO',
            category: 'General',
            dosage: '500mg',
            form: 'Tablet',
            price: 28,
            mrp: 32,
            discount: 12.5,
            quantity: 60,
            minQuantity: 6,
            manufacturer: 'GSK Consumer Healthcare',
            prescriptionRequired: false,
            description: 'Fast relief from acidity and gas.',
            expiryDate: new Date('2025-07-15')
        }
    ];

    // Create medicine stocks for first pharmacy (Gram Pharmacy)
    for (const med of medicines) {
        await MedicineStock.create({ ...med, pharmacyId: pharmacy1._id });
    }

    // Create medicines for second pharmacy (Apollo Hospital Pharmacy)
    const hospitalPharmacyMedicines = [
        {
            medicineName: 'Paracetamol 500mg',
            genericName: 'Paracetamol',
            brand: 'Calpol',
            category: 'General',
            dosage: '500mg',
            form: 'Tablet',
            price: 28,
            mrp: 32,
            discount: 12.5,
            quantity: 150,
            minQuantity: 10,
            manufacturer: 'GlaxoSmithKline',
            prescriptionRequired: false,
            description: 'Pain reliever and fever reducer',
            expiryDate: new Date('2026-10-31')
        },
        {
            medicineName: 'Ibuprofen 400mg',
            genericName: 'Ibuprofen',
            brand: 'Brufen',
            category: 'Pain Relief',
            dosage: '400mg',
            form: 'Tablet',
            price: 35,
            mrp: 40,
            discount: 12.5,
            quantity: 100,
            minQuantity: 5,
            manufacturer: 'Abbott',
            prescriptionRequired: false,
            description: 'Anti-inflammatory and pain reliever',
            expiryDate: new Date('2026-06-30')
        },
        {
            medicineName: 'Ciprofloxacin 500mg',
            genericName: 'Ciprofloxacin',
            brand: 'Cipro',
            category: 'Antibiotics',
            dosage: '500mg',
            form: 'Tablet',
            price: 80,
            mrp: 95,
            discount: 15.79,
            quantity: 75,
            minQuantity: 5,
            manufacturer: 'Bayer',
            prescriptionRequired: true,
            description: 'Antibiotic used to treat bacterial infections',
            expiryDate: new Date('2025-12-31')
        },
        {
            medicineName: 'Metformin 500mg',
            genericName: 'Metformin',
            brand: 'Glycomet',
            category: 'Diabetes',
            dosage: '500mg',
            form: 'Tablet',
            price: 60,
            mrp: 70,
            discount: 14.29,
            quantity: 120,
            minQuantity: 10,
            manufacturer: 'USV Ltd',
            prescriptionRequired: true,
            description: 'Oral anti-diabetic medication',
            expiryDate: new Date('2026-03-31')
        },
        {
            medicineName: 'Omeprazole 20mg',
            genericName: 'Omeprazole',
            brand: 'Omez',
            category: 'Gastrointestinal',
            dosage: '20mg',
            form: 'Capsule',
            price: 45,
            mrp: 55,
            discount: 18.18,
            quantity: 80,
            minQuantity: 8,
            manufacturer: 'Dr. Reddy\'s Labs',
            prescriptionRequired: true,
            description: 'Proton pump inhibitor for acid reflux',
            expiryDate: new Date('2026-01-31')
        }
    ];

    // Create medicine stocks for second pharmacy (Apollo Hospital Pharmacy)
    for (const med of hospitalPharmacyMedicines) {
        await MedicineStock.create({ ...med, pharmacyId: pharmacy2._id });
    }

    // ─────────────────────────────────────────────────────────────────────
    // The care network.
    //
    // A patient does not move between "hospitals", they move up a chain:
    // sub-centre → PHC → CHC → district hospital. Apollo already existed and
    // sits at the top of that chain rather than beside it, so the existing
    // hospital login now owns a real network instead of a lone building.
    //
    // Capabilities are deliberately uneven. Obstetrics exists only at the
    // district hospital and ultrasound only above the PHC, which is what makes
    // a referral necessary at all — a network where every node can do
    // everything has nothing to coordinate.
    // ─────────────────────────────────────────────────────────────────────

    hospital.level = 'district_hospital';
    hospital.parentFacilityId = null;
    hospital.operatingDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    hospital.capabilities = [
        'general_opd', 'teleconsultation', 'anc', 'immunization', 'essential_drugs',
        'lab_basic', 'lab_advanced', 'xray', 'ultrasound', 'obstetrics',
        'pediatrics', 'surgery', 'inpatient', 'emergency_24x7', 'ambulance', 'blood_bank'
    ];
    await hospital.save();

    const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    // parent is a key from earlier in this list, so the tree builds in one pass.
    const networkDefs = [
        {
            key: 'chc', name: 'CHC Sundarpur', level: 'chc', parent: null,
            email: 'chc.sundarpur@gramsathi.in', phone: '+91-9812300001',
            address: 'Sundarpur Road, Block Sundarpur, District Ludhiana, Punjab - 141002',
            coordinates: [75.7900, 30.8600],
            operatingDays: [...WEEKDAYS, 'sun'],
            capabilities: [
                'general_opd', 'teleconsultation', 'anc', 'immunization', 'essential_drugs',
                'lab_basic', 'lab_advanced', 'xray', 'pediatrics', 'inpatient',
                'emergency_24x7', 'ambulance'
            ]
        },
        {
            key: 'phcRampur', name: 'PHC Rampur', level: 'phc', parent: 'chc',
            email: 'phc.rampur@gramsathi.in', phone: '+91-9812300002',
            address: 'Village Rampur, Block Sundarpur, District Ludhiana, Punjab - 141013',
            coordinates: [75.7200, 30.8200],
            operatingDays: WEEKDAYS,
            capabilities: ['general_opd', 'teleconsultation', 'anc', 'immunization', 'essential_drugs', 'lab_basic']
        },
        {
            // No teleconsultation here on purpose: an uneven network is the
            // realistic one, and it gives the dashboards something true to show.
            key: 'phcBhagwanpur', name: 'PHC Bhagwanpur', level: 'phc', parent: 'chc',
            email: 'phc.bhagwanpur@gramsathi.in', phone: '+91-9812300003',
            address: 'Village Bhagwanpur, Block Sundarpur, District Ludhiana, Punjab - 141014',
            coordinates: [75.8300, 30.7900],
            operatingDays: ['mon', 'wed', 'fri'],
            capabilities: ['general_opd', 'anc', 'immunization', 'essential_drugs', 'lab_basic']
        },
        {
            key: 'scRampurKhurd', name: 'Sub-Centre Rampur Khurd', level: 'sub_centre', parent: 'phcRampur',
            email: 'sc.rampurkhurd@gramsathi.in', phone: '+91-9812300004',
            address: 'Village Rampur Khurd, Block Sundarpur, District Ludhiana, Punjab - 141013',
            coordinates: [75.6900, 30.8000],
            operatingDays: WEEKDAYS,
            capabilities: ['anc', 'immunization', 'essential_drugs']
        },
        {
            key: 'scKotla', name: 'Sub-Centre Kotla', level: 'sub_centre', parent: 'phcRampur',
            email: 'sc.kotla@gramsathi.in', phone: '+91-9812300005',
            address: 'Village Kotla, Block Sundarpur, District Ludhiana, Punjab - 141013',
            coordinates: [75.7400, 30.7800],
            operatingDays: WEEKDAYS,
            capabilities: ['anc', 'immunization', 'essential_drugs']
        },
        {
            key: 'scBhagwanpur', name: 'Sub-Centre Bhagwanpur', level: 'sub_centre', parent: 'phcBhagwanpur',
            email: 'sc.bhagwanpur@gramsathi.in', phone: '+91-9812300006',
            address: 'Village Bhagwanpur, Block Sundarpur, District Ludhiana, Punjab - 141014',
            coordinates: [75.8600, 30.7600],
            operatingDays: WEEKDAYS,
            capabilities: ['anc', 'immunization', 'essential_drugs']
        }
    ];

    // Each facility gets its own admin account. getHospitalProfile looks a
    // facility up with findOne({ ownerId }), so one owner must map to exactly
    // one facility or the existing hospital dashboard picks an arbitrary one.
    const facilities = { apollo: hospital };

    for (const def of networkDefs) {
        const admin = await User.create({
            name: `${def.name} In-charge`,
            email: def.email,
            passwordHash: pw,
            role: 'hospital',
            phone: def.phone
        });

        const facility = await Hospital.create({
            name: def.name,
            email: def.email,
            phone: def.phone,
            address: def.address,
            location: { type: 'Point', coordinates: def.coordinates },
            level: def.level,
            capabilities: def.capabilities,
            operatingDays: def.operatingDays,
            parentFacilityId: def.parent ? facilities[def.parent]._id : hospital._id,
            description: `Public health facility under Block Sundarpur, District Ludhiana.`,
            ownerId: admin._id
        });

        await User.findByIdAndUpdate(admin._id, { hospitalId: facility._id });
        facilities[def.key] = facility;
    }

    // A medical officer at the PHC. Without a doctor at the primary tier the
    // chain has no one to consult before referring upward.
    const phcDoctor = await User.create({
        name: 'Dr. Amrit Singh',
        email: 'amrit@gramsathi.in',
        passwordHash: pw,
        role: 'doctor',
        specialization: 'General Medicine',
        qualification: 'MBBS',
        availability: '9am-2pm',
        phone: '+91-9812300010',
        hospitalId: facilities.phcRampur._id
    });
    facilities.phcRampur.doctors = [phcDoctor._id];
    await facilities.phcRampur.save();

    // Health workers. The catchment is the point: it is what will scope their
    // patient list, their worklist, and eventually what their phone holds
    // offline. Villages here match the addresses above, including Sundarpur,
    // where the existing seeded patient lives.
    const workerDefs = [
        {
            name: 'Sunita Devi', email: 'sunita@gramsathi.in', workerType: 'asha',
            facility: 'scRampurKhurd', villages: ['Rampur Khurd', 'Nangal'], phone: '+91-9812300021'
        },
        {
            name: 'Preeti Kaur', email: 'preeti@gramsathi.in', workerType: 'asha',
            facility: 'scKotla', villages: ['Kotla', 'Jhande'], phone: '+91-9812300022'
        },
        {
            name: 'Manjeet Kaur', email: 'manjeet@gramsathi.in', workerType: 'asha',
            facility: 'scBhagwanpur', villages: ['Bhagwanpur', 'Sundarpur'], phone: '+91-9812300023'
        },
        {
            name: 'Harpreet Kaur', email: 'harpreet@gramsathi.in', workerType: 'anm',
            facility: 'scRampurKhurd', villages: ['Rampur Khurd', 'Nangal', 'Dhandari'], phone: '+91-9812300024'
        },
        {
            name: 'Gurpreet Singh', email: 'gurpreet@gramsathi.in', workerType: 'cho',
            facility: 'phcRampur',
            villages: ['Rampur Khurd', 'Nangal', 'Dhandari', 'Kotla', 'Jhande', 'Barewal'],
            phone: '+91-9812300025'
        }
    ];

    /**
     * Village patients, one per catchment.
     *
     * Registered the way a health worker registers someone at their door: no
     * real email address and no chosen password, so the record exists without
     * being an account anybody can sign into. Placed in different catchments
     * deliberately — a boundary with everyone on one side of it is untested.
     */
    const villagePatients = [
        { name: 'Kamla Devi', age: 26, gender: 'female', village: 'Rampur Khurd', phone: '+91-9812311001' },
        { name: 'Ramesh Lal', age: 54, gender: 'male', village: 'Nangal', phone: '+91-9812311002' },
        { name: 'Geeta Rani', age: 31, gender: 'female', village: 'Kotla', phone: '+91-9812311003' }
    ];
    for (const p of villagePatients) {
        await User.create({
            ...p,
            email: `gs-seed-${p.name.toLowerCase().replace(/\s+/g, '')}@patient.gramsathi.local`,
            passwordHash: await bcrypt.hash(`${Math.random()}${Date.now()}`, 10),
            role: 'patient'
        });
    }

    const workers = [];
    for (const def of workerDefs) {
        workers.push(await User.create({
            name: def.name,
            email: def.email,
            passwordHash: pw,
            role: 'health_worker',
            workerType: def.workerType,
            phone: def.phone,
            hospitalId: facilities[def.facility]._id,
            catchmentVillages: def.villages
        }));
    }

    console.log('Seeded successfully:');
    console.log('- Patient:', patient.email, '(password: password123)');
    console.log('- Doctor:', doctor.email, '(password: password123)');
    console.log('- Pharmacy Owner 1:', pharmacyOwner.email, '(password: password123)');
    console.log('- Pharmacy Owner 2:', pharmacyOwner2.email, '(password: password123)');
    console.log('- Hospital Admin:', hospitalUser.email, '(password: password123)');
    console.log('- Pharmacy 1:', pharmacy1.name);
    console.log('- Pharmacy 2 (Hospital-associated):', pharmacy2.name);
    console.log('- Hospital:', hospital.name);
    console.log('- Medicines for Pharmacy 1:', medicines.length, 'items created');
    console.log('- Medicines for Pharmacy 2:', hospitalPharmacyMedicines.length, 'items created');
    console.log('');
    console.log('Care network (all passwords: password123):');
    console.log(`  ${hospital.name} [district_hospital] — ${hospitalUser.email}`);
    for (const def of networkDefs) {
        const f = facilities[def.key];
        const parentName = f.parentFacilityId ? Object.values(facilities).find(x => String(x._id) === String(f.parentFacilityId))?.name : '—';
        console.log(`    ${f.name} [${f.level}] under ${parentName} — ${f.email}`);
    }
    console.log('');
    console.log('Health workers:');
    for (const w of workers) {
        console.log(`  ${w.name} (${w.workerType}) — ${w.email} — villages: ${w.catchmentVillages.join(', ')}`);
    }
    console.log(`  PHC medical officer: ${phcDoctor.email}`);
    console.log('');
    console.log('Village patients (records, not logins):');
    for (const p of villagePatients) console.log(`  ${p.name}, ${p.age} — ${p.village}`);
    console.log('');
    console.log('You can now:');
    console.log('1. Login as pharmacy owner to manage inventory');
    console.log('2. Login as patient to browse and order medicines');
    console.log('3. Test the complete e-commerce flow');
    console.log('4. GET /api/facilities/tree to see the care network');

    process.exit(0);
};

run().catch((e) => { console.error(e); process.exit(1); });


