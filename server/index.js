require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const xlsx = require('xlsx');

const { db, initDb } = require('./db');
const { generateInvoicePDF, invoicesDir } = require('./invoicePdf');
const {
  generateUpiLink,
  formatWhatsAppPhone,
  isValidEmail,
  getWhatsAppConfig,
  getEmailConfig,
  sendWhatsAppReminder,
  sendWhatsAppInvoice,
  sendEmailReminder,
  generateWhatsAppReminderLink
} = require('./notifications');

// Initialize Database
initDb();

const app = express();
const PORT = process.env.PORT || 5000;

// Setup Uploads directory
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});

const photoFilter = (req, file, cb) => {
  const allowedImg = /jpeg|jpg|png|webp/;
  const ext = path.extname(file.originalname).toLowerCase().slice(1);
  if (allowedImg.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Student photo must be JPG, PNG, or WebP format.'));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|pdf|xlsx|xls|csv/;
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (allowed.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Please upload JPG, PNG, PDF, or Excel/CSV files.'));
    }
  }
});

const photoUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: photoFilter
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(uploadsDir));
app.use('/invoices', express.static(invoicesDir));

// Session Setup
app.use(session({
  name: 'sdn_portal_sid',
  secret: process.env.SESSION_SECRET || 'sdn_bharatanatyam_academy_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));

// ── Role Authorization Middlewares ────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  next();
}

function requireManagement(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  if (req.session.user.role !== 'MANAGEMENT') {
    return res.status(403).json({ error: 'Access denied. Management authorization required.' });
  }
  next();
}

function requireFacultyOrManagement(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  if (req.session.user.role !== 'MANAGEMENT' && req.session.user.role !== 'FACULTY') {
    return res.status(403).json({ error: 'Access denied. Faculty or Management authorization required.' });
  }
  next();
}

// ── Helper: compute age from DOB ──────────────────────────────────────────────
function computeAgeFromDob(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth)) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age > 0 ? age : 0;
}

function computeDueDate(month, year) {
  const monthNames = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  let monthIndex = -1;
  if (typeof month === 'number' || /^\d+$/.test(String(month).trim())) {
    monthIndex = parseInt(month, 10) - 1;
  } else if (typeof month === 'string') {
    monthIndex = monthNames.findIndex(m => m.toLowerCase() === month.trim().toLowerCase());
  }
  if (monthIndex < 0 || monthIndex > 11) return null;
  const y = parseInt(year, 10) || new Date().getFullYear();
  const d = new Date(Date.UTC(y, monthIndex, 7));
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================

app.post('/api/auth/login', (req, res) => {
  const { portalType, username, password } = req.body;

  if (!portalType || !username || !password) {
    return res.status(400).json({ error: 'Portal type, username, and password are required.' });
  }

  const normalizedRole = portalType.toUpperCase();
  if (normalizedRole !== 'MANAGEMENT' && normalizedRole !== 'FACULTY') {
    return res.status(400).json({ error: 'Invalid portal type specified.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials. Please verify your username.' });
  }

  if (user.role !== normalizedRole) {
    return res.status(403).json({
      error: `Access Denied: These credentials cannot access the ${portalType} Portal. Please select the correct portal type.`
    });
  }

  const passwordMatch = bcrypt.compareSync(password, user.password_hash);
  if (!passwordMatch) {
    return res.status(401).json({ error: 'Invalid credentials. Please verify your password.' });
  }

  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name
  };

  return res.json({
    message: 'Authentication successful',
    user: req.session.user
  });
});

app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ authenticated: true, user: req.session.user });
  }
  return res.json({ authenticated: false });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Could not log out. Please try again.' });
    res.clearCookie('sdn_portal_sid');
    return res.json({ message: 'Logged out successfully.' });
  });
});

// ==========================================
// MANAGEMENT DASHBOARD STATS
// ==========================================

app.get('/api/dashboard/stats', requireManagement, (req, res) => {
  try {
    // Only count ACTIVE students
    const totalStudents = db.prepare(`SELECT COUNT(*) as count FROM students WHERE admission_status = 'ACTIVE'`).get().count;
    const currentEnrollments = db.prepare(`SELECT COUNT(*) as count FROM enrollments WHERE status = 'ACTIVE'`).get().count;

    // Age Group Segregation for enrolled ACTIVE students (using DOB when available, else age column)
    const ageGroups = db.prepare(`
      SELECT
        SUM(CASE WHEN COALESCE(
          CASE WHEN s.date_of_birth IS NOT NULL THEN
            (strftime('%Y', 'now') - strftime('%Y', s.date_of_birth)) -
            (strftime('%m-%d', 'now') < strftime('%m-%d', s.date_of_birth))
          ELSE s.age END, 0) BETWEEN 3 AND 7 THEN 1 ELSE 0 END) as kids,
        SUM(CASE WHEN COALESCE(
          CASE WHEN s.date_of_birth IS NOT NULL THEN
            (strftime('%Y', 'now') - strftime('%Y', s.date_of_birth)) -
            (strftime('%m-%d', 'now') < strftime('%m-%d', s.date_of_birth))
          ELSE s.age END, 0) BETWEEN 8 AND 12 THEN 1 ELSE 0 END) as juniors,
        SUM(CASE WHEN COALESCE(
          CASE WHEN s.date_of_birth IS NOT NULL THEN
            (strftime('%Y', 'now') - strftime('%Y', s.date_of_birth)) -
            (strftime('%m-%d', 'now') < strftime('%m-%d', s.date_of_birth))
          ELSE s.age END, 0) BETWEEN 13 AND 17 THEN 1 ELSE 0 END) as teens,
        SUM(CASE WHEN COALESCE(
          CASE WHEN s.date_of_birth IS NOT NULL THEN
            (strftime('%Y', 'now') - strftime('%Y', s.date_of_birth)) -
            (strftime('%m-%d', 'now') < strftime('%m-%d', s.date_of_birth))
          ELSE s.age END, 0) >= 18 THEN 1 ELSE 0 END) as seniors
      FROM students s
      JOIN enrollments e ON e.student_id = s.id AND e.status = 'ACTIVE'
      WHERE s.admission_status = 'ACTIVE'
    `).get();

    const batchBreakdown = db.prepare(`
      SELECT b.batch_name, b.level, COUNT(e.id) as enrolled_count
      FROM batches b
      LEFT JOIN enrollments e ON e.batch_id = b.id AND e.status = 'ACTIVE'
      GROUP BY b.id
      ORDER BY b.id ASC
    `).all();

    const pendingStudents = db.prepare(`
      SELECT COUNT(DISTINCT f.student_id) as count
      FROM fee_records f
      JOIN students s ON s.id = f.student_id
      WHERE f.status IN ('Pending', 'Overdue') AND s.admission_status = 'ACTIVE'
    `).get();
    const completedStudents = db.prepare(`
      SELECT COUNT(DISTINCT f.student_id) as count
      FROM fee_records f
      JOIN students s ON s.id = f.student_id
      WHERE f.status = 'Paid'
        AND s.admission_status = 'ACTIVE'
        AND f.student_id NOT IN (
          SELECT student_id FROM fee_records WHERE status IN ('Pending', 'Overdue')
        )
    `).get();
    const overdueStudents = db.prepare(`
      SELECT COUNT(DISTINCT f.student_id) as count
      FROM fee_records f
      JOIN students s ON s.id = f.student_id
      WHERE f.status = 'Overdue' AND s.admission_status = 'ACTIVE'
    `).get();
    const verificationPendingStudents = db.prepare(`
      SELECT COUNT(DISTINCT student_id) as count FROM fee_records WHERE status = 'Verification Pending'
    `).get();

    const recentStudents = db.prepare(`
      SELECT s.id, s.student_id_code, s.name, s.age, s.date_of_birth, s.phone, s.email, s.admission_status, s.created_at, b.batch_name
      FROM students s
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ACTIVE'
      LEFT JOIN batches b ON b.id = e.batch_id
      WHERE s.admission_status = 'ACTIVE'
      ORDER BY s.id DESC
      LIMIT 5
    `).all();

    const recentPayments = db.prepare(`
      SELECT f.id, f.fee_type, f.amount, f.status, f.payment_method, f.payment_reference, f.payment_date, f.updated_at,
             s.name as student_name, s.student_id_code
      FROM fee_records f
      JOIN students s ON s.id = f.student_id
      WHERE f.status IN ('Paid', 'Verification Pending')
      ORDER BY f.updated_at DESC
      LIMIT 5
    `).all();

    res.json({
      totalStudents,
      currentEnrollments,
      ageGroups: {
        kids: ageGroups.kids || 0,
        juniors: ageGroups.juniors || 0,
        teens: ageGroups.teens || 0,
        seniors: ageGroups.seniors || 0
      },
      batchBreakdown,
      pendingFees: { count: pendingStudents.count },
      completedFees: { count: completedStudents.count },
      overdueFees: { count: overdueStudents.count },
      verificationPending: { count: verificationPendingStudents.count },
      recentStudents,
      recentPayments
    });
  } catch (err) {
    console.error('Dashboard Stats Error:', err);
    res.status(500).json({ error: 'Failed to retrieve dashboard statistics: ' + err.message });
  }
});

// ==========================================
// STUDENT ONBOARDING & MANAGEMENT
// ==========================================

// Add / Onboard new student
app.post('/api/students', requireManagement, photoUpload.single('photo'), (req, res) => {
  const {
    name, date_of_birth, mother_tongue, father_name, mother_name,
    phone, email, address, educational_qualification, previous_experience,
    batch_id
  } = req.body;

  // Required field validation
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Student Name is required.' });
  }
  if (!date_of_birth || !date_of_birth.trim()) {
    return res.status(400).json({ error: 'Date of Birth is required.' });
  }
  const dobParsed = new Date(date_of_birth);
  if (isNaN(dobParsed)) {
    return res.status(400).json({ error: 'Date of Birth must be a valid date.' });
  }

  // WhatsApp contact number validation (10 digits)
  let cleanPhone = (phone || '').trim().replace(/[\s\-()+]/g, '');
  if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) cleanPhone = cleanPhone.slice(2);
  if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) cleanPhone = cleanPhone.slice(1);
  if (!cleanPhone || cleanPhone.length !== 10 || !/^\d{10}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'Valid 10-digit WhatsApp Contact Number is required.' });
  }

  const cleanEmail = (email || '').trim();
  // Email is optional but must be valid if provided
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Email ID format is invalid.' });
  }

  // Duplicate check on phone (and email if provided)
  let existing;
  if (cleanEmail) {
    existing = db.prepare('SELECT id FROM students WHERE phone = ? OR email = ?').get(cleanPhone, cleanEmail);
  } else {
    existing = db.prepare('SELECT id FROM students WHERE phone = ?').get(cleanPhone);
  }
  if (existing) {
    return res.status(409).json({ error: 'A student with this Phone Number or Email ID is already registered.' });
  }

  const studentCount = db.prepare('SELECT COUNT(*) as count FROM students').get().count;
  const studentCode = `SDN-STU-${1000 + studentCount + 1}`;
  const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const computedAge = computeAgeFromDob(date_of_birth);

  const insertStudent = db.prepare(`
    INSERT INTO students (
      student_id_code, name, date_of_birth, age, mother_tongue, father_name, mother_name,
      phone, email, address, educational_qualification, previous_experience, photo_url
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = insertStudent.run(
    studentCode,
    name.trim(),
    date_of_birth.trim(),
    computedAge,
    (mother_tongue || '').trim() || null,
    (father_name || '').trim() || null,
    (mother_name || '').trim() || null,
    cleanPhone,
    cleanEmail || null,
    (address || '').trim() || null,
    (educational_qualification || '').trim() || null,
    (previous_experience || '').trim() || null,
    photoUrl
  );
  const newStudentId = info.lastInsertRowid;

  // Optional batch assignment during onboarding
  if (batch_id && parseInt(batch_id, 10) > 0) {
    db.prepare(`
      INSERT INTO enrollments (student_id, batch_id, enrolled_date, status, updated_by_role)
      VALUES (?, ?, date('now'), 'ACTIVE', 'MANAGEMENT')
    `).run(newStudentId, parseInt(batch_id, 10));
  }

  res.status(201).json({
    message: 'Student onboarded successfully',
    studentId: newStudentId,
    studentCode
  });
});

// Import existing students from Excel/CSV
app.post('/api/students/import', requireManagement, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Please upload an Excel (.xlsx/.xls) or CSV file.' });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

    if (!sheetData || sheetData.length === 0) {
      return res.status(400).json({ error: 'The uploaded file contains no rows.' });
    }

    const preview = req.query.preview === 'true';
    const results = {
      totalRows: sheetData.length,
      validRows: 0,
      invalidRows: 0,
      duplicates: 0,
      errors: [],
      imported: []
    };

    const insertStudent = db.prepare(`
      INSERT INTO students (student_id_code, name, date_of_birth, age, phone, email, father_name, mother_name, address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let currentCount = db.prepare('SELECT COUNT(*) as count FROM students').get().count;

    for (let i = 0; i < sheetData.length; i++) {
      const row = sheetData[i];
      const name = (row['Name'] || row['Student Name'] || row['name'] || '').toString().trim();
      const phone = (row['Phone Number'] || row['Phone'] || row['WhatsApp'] || row['phone'] || '').toString().trim().replace(/\s+/g, '');
      const email = (row['Email IDs'] || row['Email ID'] || row['Email'] || row['email'] || '').toString().trim();
      const dob = (row['Date of Birth'] || row['DOB'] || row['date_of_birth'] || '').toString().trim();
      const fatherName = (row['Father Name'] || row['Father'] || '').toString().trim();
      const motherName = (row['Mother Name'] || row['Mother'] || '').toString().trim();
      const address = (row['Address'] || row['address'] || '').toString().trim();

      const rowNum = i + 2;

      if (!name) {
        results.invalidRows++;
        results.errors.push(`Row ${rowNum}: Student Name is missing.`);
        continue;
      }
      if (!phone || phone.length < 7) {
        results.invalidRows++;
        results.errors.push(`Row ${rowNum}: Invalid phone number for ${name}.`);
        continue;
      }

      // Check duplicates
      const dup = email
        ? db.prepare('SELECT id FROM students WHERE phone = ? OR email = ?').get(phone, email)
        : db.prepare('SELECT id FROM students WHERE phone = ?').get(phone);
      if (dup) {
        results.duplicates++;
        results.errors.push(`Row ${rowNum}: Duplicate record found with phone ${phone}${email ? ` or email ${email}` : ''}.`);
        continue;
      }

      const computedAge = dob ? computeAgeFromDob(dob) : null;

      results.validRows++;
      results.imported.push({ name, dob, phone, email, fatherName, motherName, address });

      if (!preview) {
        currentCount++;
        const code = `SDN-STU-${1000 + currentCount}`;
        insertStudent.run(code, name, dob || null, computedAge, phone, email || null, fatherName || null, motherName || null, address || null);
      }
    }

    try { fs.unlinkSync(req.file.path); } catch (e) {}

    res.json({ preview, summary: results });
  } catch (err) {
    console.error('Import Error:', err);
    res.status(500).json({ error: 'Failed to process spreadsheet file: ' + err.message });
  }
});

// Search & List Students (Management & Faculty)
// Supports ?status=ACTIVE|INACTIVE|ALL (default: ACTIVE)
app.get('/api/students', requireFacultyOrManagement, (req, res) => {
  const { search, page = 1, limit = 15, batch_id, status = 'ACTIVE' } = req.query;
  const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const pageLimit = parseInt(limit, 10);

  let query = `
    SELECT s.id, s.student_id_code, s.name, s.date_of_birth, s.age, s.mother_tongue,
           s.father_name, s.mother_name, s.phone, s.email, s.address,
           s.educational_qualification, s.previous_experience,
           s.photo_url, s.admission_status, s.leaving_reason, s.left_at, s.created_at,
           b.id as batch_id, b.batch_name, b.level as batch_level, b.schedule as batch_schedule,
           COALESCE(
             (SELECT status FROM fee_records WHERE student_id = s.id AND (fee_type LIKE '%Month%' OR fee_type LIKE '%Tuition%' OR fee_type LIKE '%Term%') ORDER BY id DESC LIMIT 1),
             (SELECT status FROM fee_records WHERE student_id = s.id ORDER BY id DESC LIMIT 1),
             'Pending'
           ) as latest_month_fee_status,
           (SELECT fee_type FROM fee_records WHERE student_id = s.id ORDER BY id DESC LIMIT 1) as latest_fee_type
    FROM students s
    LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ACTIVE'
    LEFT JOIN batches b ON b.id = e.batch_id
    WHERE 1=1
  `;
  const params = [];

  // Status filter: ACTIVE, INACTIVE, or ALL
  if (status === 'ACTIVE') {
    query += ` AND s.admission_status = 'ACTIVE'`;
  } else if (status === 'INACTIVE') {
    query += ` AND s.admission_status IN ('INACTIVE', 'WITHDRAWN', 'ON_LEAVE')`;
  }
  // 'ALL' → no filter

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    query += ` AND (s.name LIKE ? OR s.phone LIKE ? OR s.email LIKE ? OR s.student_id_code LIKE ?)`;
    params.push(term, term, term, term);
  }

  if (batch_id && parseInt(batch_id, 10) > 0) {
    query += ` AND b.id = ?`;
    params.push(parseInt(batch_id, 10));
  }

  const countQuery = `SELECT COUNT(*) as total FROM (${query})`;
  const total = db.prepare(countQuery).get(...params).total;

  // Alphabetical by name within each page
  query += ` ORDER BY s.name COLLATE NOCASE ASC LIMIT ? OFFSET ?`;
  params.push(pageLimit, offset);

  const students = db.prepare(query).all(...params);

  if (req.session.user.role === 'FACULTY') {
    students.forEach(s => {
      delete s.latest_month_fee_status;
      delete s.latest_fee_type;
    });
  }

  res.json({
    students,
    total,
    page: parseInt(page, 10),
    totalPages: Math.ceil(total / pageLimit)
  });
});

// Get Student Detail
app.get('/api/students/:id', requireFacultyOrManagement, (req, res) => {
  const student = db.prepare(`
    SELECT s.*, b.id as batch_id, b.batch_name, b.level as batch_level, b.schedule, b.instructor
    FROM students s
    LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'ACTIVE'
    LEFT JOIN batches b ON b.id = e.batch_id
    WHERE s.id = ?
  `).get(req.params.id);

  if (!student) {
    return res.status(404).json({ error: 'Student record not found.' });
  }

  // Fees and enrollment history only accessible to Management
  let fees = [];
  let reminders = [];
  let enrollmentHistory = [];
  if (req.session.user.role === 'MANAGEMENT') {
    fees = db.prepare('SELECT * FROM fee_records WHERE student_id = ? ORDER BY id DESC').all(req.params.id);
    reminders = db.prepare('SELECT * FROM fee_reminders WHERE student_id = ? ORDER BY id DESC').all(req.params.id);
    enrollmentHistory = db.prepare(`
      SELECT e.*, b.batch_name, b.schedule
      FROM enrollments e
      LEFT JOIN batches b ON b.id = e.batch_id
      WHERE e.student_id = ?
      ORDER BY e.id DESC
    `).all(req.params.id);
  }

  res.json({ student, fees, reminders, enrollmentHistory });
});

// Update Student Info (Management Only)
app.put('/api/students/:id', requireManagement, photoUpload.single('photo'), (req, res) => {
  const {
    name, date_of_birth, mother_tongue, father_name, mother_name,
    phone, email, address, educational_qualification, previous_experience,
    admission_status, leaving_reason
  } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Student Name is required.' });
  if (!date_of_birth || !date_of_birth.trim()) return res.status(400).json({ error: 'Date of Birth is required.' });

  let cleanPhone = (phone || '').trim().replace(/[\s\-()+]/g, '');
  if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) cleanPhone = cleanPhone.slice(2);
  if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) cleanPhone = cleanPhone.slice(1);
  if (!cleanPhone || cleanPhone.length !== 10 || !/^\d{10}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'WhatsApp Contact Number must be exactly 10 digits.' });
  }

  const cleanEmail = (email || '').trim();
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Email ID format is invalid.' });
  }

  const newStatus = admission_status || 'ACTIVE';
  // Require a reason if marking inactive/withdrawn
  if ((newStatus === 'INACTIVE' || newStatus === 'WITHDRAWN') && (!leaving_reason || !leaving_reason.trim())) {
    return res.status(400).json({ error: 'A Reason for Leaving is required when marking a student as Inactive or Withdrawn.' });
  }

  const existingStudent = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!existingStudent) return res.status(404).json({ error: 'Student not found.' });

  // Only update photo if a new file was uploaded
  const photoUrl = req.file ? `/uploads/${req.file.filename}` : existingStudent.photo_url;
  const computedAge = computeAgeFromDob(date_of_birth);

  const leftAt = (newStatus === 'INACTIVE' || newStatus === 'WITHDRAWN')
    ? (existingStudent.left_at || new Date().toISOString())
    : null;

  // If switching back to ACTIVE, clear leaving fields
  const leavingReasonToSave = (newStatus === 'ACTIVE' || newStatus === 'ON_LEAVE')
    ? null
    : (leaving_reason || '').trim();

  db.prepare(`
    UPDATE students
    SET name = ?, date_of_birth = ?, age = ?, mother_tongue = ?, father_name = ?, mother_name = ?,
        phone = ?, email = ?, address = ?, educational_qualification = ?, previous_experience = ?,
        photo_url = ?, admission_status = ?, leaving_reason = ?, left_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    name.trim(),
    date_of_birth.trim(),
    computedAge,
    (mother_tongue || '').trim() || null,
    (father_name || '').trim() || null,
    (mother_name || '').trim() || null,
    cleanPhone,
    cleanEmail || null,
    (address || '').trim() || null,
    (educational_qualification || '').trim() || null,
    (previous_experience || '').trim() || null,
    photoUrl,
    newStatus,
    leavingReasonToSave,
    leftAt,
    req.params.id
  );

  // If student is being marked Inactive/Withdrawn, deactivate their enrollment
  if (newStatus === 'INACTIVE' || newStatus === 'WITHDRAWN') {
    db.prepare(`UPDATE enrollments SET status = 'WITHDRAWN' WHERE student_id = ? AND status = 'ACTIVE'`).run(req.params.id);
  }

  res.json({ message: 'Student updated successfully.' });
});

// Mark student as Inactive (soft delete) — Management only
app.post('/api/students/:id/deactivate', requireManagement, (req, res) => {
  const { leaving_reason } = req.body;
  if (!leaving_reason || !leaving_reason.trim()) {
    return res.status(400).json({ error: 'Reason for Leaving is required.' });
  }

  const student = db.prepare('SELECT id, name, admission_status FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  if (student.admission_status === 'INACTIVE') {
    return res.status(400).json({ error: 'Student is already marked as Inactive.' });
  }

  db.prepare(`
    UPDATE students
    SET admission_status = 'INACTIVE', leaving_reason = ?, left_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(leaving_reason.trim(), req.params.id);

  // Deactivate enrollment
  db.prepare(`UPDATE enrollments SET status = 'WITHDRAWN' WHERE student_id = ? AND status = 'ACTIVE'`).run(req.params.id);

  res.json({ message: `Student "${student.name}" has been marked as Inactive / Left.` });
});

// Reactivate a student — Management only
app.post('/api/students/:id/reactivate', requireManagement, (req, res) => {
  const student = db.prepare('SELECT id, name FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  db.prepare(`
    UPDATE students
    SET admission_status = 'ACTIVE', leaving_reason = NULL, left_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);

  res.json({ message: `Student "${student.name}" has been reactivated.` });
});

// ── Student delete is DISABLED — students must never be permanently deleted.
// The legacy DELETE endpoint now returns a clear error to prevent accidental use.
app.delete('/api/students', requireManagement, (req, res) => {
  return res.status(403).json({
    error: 'Permanent deletion of student records is not permitted. Use the "Mark Inactive" action to deactivate a student while preserving their records.'
  });
});

// ==========================================
// ENROLLMENT & BATCH MANAGEMENT
// ==========================================

// List all batches
app.get('/api/batches', requireFacultyOrManagement, (req, res) => {
  const batches = db.prepare(`
    SELECT b.*,
           (SELECT COUNT(*) FROM enrollments e
            JOIN students s ON s.id = e.student_id
            WHERE e.batch_id = b.id AND e.status = 'ACTIVE' AND s.admission_status = 'ACTIVE') as enrolled_count
    FROM batches b
    ORDER BY b.id ASC
  `).all();
  res.json({ batches });
});

// Get Single Batch with Details & Enrolled Students — alphabetical
app.get('/api/batches/:id', requireFacultyOrManagement, (req, res) => {
  const batch = db.prepare(`
    SELECT b.*,
           (SELECT COUNT(*) FROM enrollments e
            JOIN students s ON s.id = e.student_id
            WHERE e.batch_id = b.id AND e.status = 'ACTIVE' AND s.admission_status = 'ACTIVE') as enrolled_count
    FROM batches b
    WHERE b.id = ?
  `).get(req.params.id);

  if (!batch) {
    return res.status(404).json({ error: 'Batch not found.' });
  }

  // Only active students in alphabetical order
  const students = db.prepare(`
    SELECT s.id, s.student_id_code, s.name, s.age, s.date_of_birth, s.phone, s.email,
           s.father_name, s.mother_name, s.photo_url, e.enrolled_date
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    WHERE e.batch_id = ? AND e.status = 'ACTIVE' AND s.admission_status = 'ACTIVE'
    ORDER BY s.name COLLATE NOCASE ASC
  `).all(req.params.id);

  res.json({ batch, students });
});

// Create new batch (Management only) — no capacity restriction
app.post('/api/batches', requireManagement, (req, res) => {
  const { batch_code, batch_name, level, schedule, instructor } = req.body;
  if (!batch_name || !batch_name.trim()) {
    return res.status(400).json({ error: 'Batch Name is required.' });
  }
  if (!schedule || !schedule.trim()) {
    return res.status(400).json({ error: 'Schedule / Timings are required.' });
  }
  if (!instructor || !instructor.trim()) {
    return res.status(400).json({ error: 'Guru / Instructor is required.' });
  }

  const codeToSave = (batch_code && batch_code.trim())
    ? batch_code.trim()
    : 'BATCH-' + Date.now().toString(36).toUpperCase();
  const levelToSave = (level && level.trim()) ? level.trim() : 'Regular';

  try {
    const info = db.prepare(`
      INSERT INTO batches (batch_code, batch_name, level, schedule, instructor, capacity)
      VALUES (?, ?, ?, ?, ?, 999)
    `).run(codeToSave, batch_name.trim(), levelToSave, schedule.trim(), instructor.trim());

    res.status(201).json({ message: 'Batch created successfully', batchId: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: 'Failed to create batch: ' + err.message });
  }
});

// Assign / Change student's batch (Both Management and Faculty)
app.post('/api/enrollments/assign', requireFacultyOrManagement, (req, res) => {
  const { student_id, batch_id, notes } = req.body;
  const userRole = req.session.user.role;

  if (!student_id) {
    return res.status(400).json({ error: 'Student ID is required.' });
  }

  const student = db.prepare('SELECT id, name, admission_status FROM students WHERE id = ?').get(student_id);
  if (!student) {
    return res.status(404).json({ error: 'Student not found.' });
  }
  if (student.admission_status !== 'ACTIVE') {
    return res.status(400).json({ error: `Cannot assign batch to an inactive student (${student.name}).` });
  }

  // Deactivate existing active enrollment (keeps history)
  db.prepare(`UPDATE enrollments SET status = 'TRANSFERRED', updated_at = CURRENT_TIMESTAMP WHERE student_id = ? AND status = 'ACTIVE'`).run(student_id);

  if (batch_id && parseInt(batch_id, 10) > 0) {
    const batch = db.prepare('SELECT id, batch_name FROM batches WHERE id = ?').get(batch_id);
    if (!batch) {
      return res.status(404).json({ error: 'Selected batch does not exist.' });
    }

    // No capacity restriction — any number of students can be assigned
    db.prepare(`
      INSERT INTO enrollments (student_id, batch_id, enrolled_date, status, notes, updated_by_role)
      VALUES (?, ?, date('now'), 'ACTIVE', ?, ?)
    `).run(student_id, parseInt(batch_id, 10), notes || null, userRole);

    return res.json({
      message: `Student "${student.name}" allocated to batch "${batch.batch_name}" successfully.`,
      updatedByRole: userRole
    });
  } else {
    return res.json({
      message: `Student "${student.name}" batch unassigned.`,
      updatedByRole: userRole
    });
  }
});

// ==========================================
// FEE MANAGEMENT & REMINDERS (Management Only)
// ==========================================

// List all fee records
app.get('/api/fees', requireManagement, (req, res) => {
  const { status, search, page = 1, limit = 20 } = req.query;
  const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const pageLimit = parseInt(limit, 10);

  let query = `
    SELECT f.*, s.name as student_name, s.student_id_code, s.phone as student_phone, s.email as student_email,
           s.father_name, s.mother_name, s.admission_status,
           (SELECT invoice_number FROM invoices WHERE fee_id = f.id LIMIT 1) as invoice_number
    FROM fee_records f
    JOIN students s ON s.id = f.student_id
    WHERE 1=1
  `;
  const params = [];

  if (status && status !== 'ALL') {
    query += ` AND f.status = ?`;
    params.push(status);
  }

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    query += ` AND (s.name LIKE ? OR s.phone LIKE ? OR s.student_id_code LIKE ? OR f.fee_type LIKE ?)`;
    params.push(term, term, term, term);
  }

  const countQuery = `SELECT COUNT(*) as total FROM (${query})`;
  const total = db.prepare(countQuery).get(...params).total;

  query += ` ORDER BY f.id DESC LIMIT ? OFFSET ?`;
  params.push(pageLimit, offset);

  const fees = db.prepare(query).all(...params);

  res.json({
    fees,
    total,
    page: parseInt(page, 10),
    totalPages: Math.ceil(total / pageLimit)
  });
});

// Simultaneous Monthly Fee Generation for All Active Students
// Due date fixed to the 7th of each month
app.post('/api/fees/generate-monthly', requireManagement, (req, res) => {
  const { month, year, amount, description } = req.body;
  if (!month || !year || !amount) {
    return res.status(400).json({ error: 'Month, Year, and Amount are required.' });
  }

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Fee amount must be a positive number.' });
  }

  // Fixed due date: 7th of the billing month
  const due_date = computeDueDate(month, year);
  if (!due_date) {
    return res.status(400).json({ error: 'Invalid month name provided.' });
  }

  // Only ACTIVE students
  const students = db.prepare(`SELECT id, name, student_id_code FROM students WHERE admission_status = 'ACTIVE'`).all();
  if (students.length === 0) {
    return res.status(400).json({ error: 'No active students found in the academy to bill.' });
  }

  const feeType = `Monthly Fee - ${month} ${year}`;
  const feeDesc = (description && description.trim()) ? description.trim() : `Monthly Tuition Fee for ${month} ${year}`;

  const checkStmt = db.prepare(`SELECT id FROM fee_records WHERE student_id = ? AND fee_type = ?`);
  const insertStmt = db.prepare(`
    INSERT INTO fee_records (student_id, fee_type, description, amount, due_date, status)
    VALUES (?, ?, ?, ?, ?, 'Pending')
  `);

  let createdCount = 0;
  let skippedCount = 0;

  const txn = db.transaction(() => {
    for (const student of students) {
      const existing = checkStmt.get(student.id, feeType);
      if (existing) {
        skippedCount++;
      } else {
        insertStmt.run(student.id, feeType, feeDesc, numAmount, due_date);
        createdCount++;
      }
    }
  });

  try {
    txn();
    res.status(201).json({
      message: `Generated monthly fees for ${createdCount} student(s) successfully (due 7th ${month} ${year})! (${skippedCount} already had dues for this period).`,
      createdCount,
      skippedCount,
      feeType,
      due_date
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate simultaneous monthly fees: ' + err.message });
  }
});

// Verify & Confirm Payment (Management Only)
// Auto-generates invoice and sends WhatsApp after successful verification
app.post('/api/fees/:id/verify', requireManagement, async (req, res) => {
  const { action, payment_method, payment_reference, verification_notes } = req.body;
  const fee = db.prepare(`
    SELECT f.*, s.name as student_name, s.phone as student_phone, s.email as student_email,
           s.father_name, s.mother_name
    FROM fee_records f
    JOIN students s ON s.id = f.student_id
    WHERE f.id = ?
  `).get(req.params.id);

  if (!fee) {
    return res.status(404).json({ error: 'Fee record not found.' });
  }

  if (action === 'APPROVE') {
    if (!payment_reference || !payment_reference.trim()) {
      return res.status(400).json({ error: 'Payment UTR / Transaction Reference is required for payment confirmation.' });
    }

    db.prepare(`
      UPDATE fee_records
      SET status = 'Paid',
          payment_method = ?,
          payment_reference = ?,
          payment_date = CURRENT_TIMESTAMP,
          verified_by = ?,
          verified_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(payment_method || fee.payment_method || 'BANK_TRANSFER', payment_reference.trim(), req.session.user.username, fee.id);

    // Auto-generate invoice PDF after payment confirmation
    let invoiceResult = null;
    let whatsappResult = null;

    try {
      // Check if invoice already exists for this fee
      const existingInvoice = db.prepare('SELECT * FROM invoices WHERE fee_id = ?').get(fee.id);

      if (!existingInvoice) {
        const isGST = true; // Default to GSTIN; management can regenerate NON_GSTIN from Invoices tab
        const totalAmount = fee.amount;
        const amountPaid = totalAmount; // Full payment assumed on verify
        const balanceRemaining = 0;

        let subtotal = totalAmount;
        let cgstRate = 9, cgstAmount = 0, sgstRate = 9, sgstAmount = 0;
        if (isGST) {
          subtotal = parseFloat((totalAmount / 1.18).toFixed(2));
          cgstAmount = parseFloat((subtotal * 0.09).toFixed(2));
          sgstAmount = parseFloat((totalAmount - subtotal - cgstAmount).toFixed(2));
        }

        const yearStr = new Date().getFullYear();
        const nextYearStr = (yearStr + 1).toString().slice(2);
        const invoiceCount = db.prepare('SELECT COUNT(*) as count FROM invoices').get().count;
        const invoiceNumber = `SDN/${yearStr}-${nextYearStr}/${String(invoiceCount + 1).padStart(4, '0')}`;

        const vendorName = process.env.INSTITUTION_NAME || 'Sridevi Nrithyalaya';
        const vendorAddress = process.env.INSTITUTION_ADDRESS || 'New No. 19, Old No. 15, AVM Colony 1st Street, Kamarajar Salai, Virugambakkam, Chennai, Tamil Nadu 600092';
        const vendorGstin = process.env.INSTITUTION_GSTIN || '33AAAAA0000A1Z5';

        const invoiceData = {
          invoice_number: invoiceNumber,
          fee_id: fee.id,
          student_id: fee.student_id,
          invoice_type: 'GSTIN',
          vendor_name: vendorName,
          vendor_address: vendorAddress,
          vendor_gstin: vendorGstin,
          student_name: fee.student_name,
          student_phone: fee.student_phone,
          student_email: fee.student_email,
          description: fee.description || fee.fee_type,
          subtotal,
          cgst_rate: cgstRate,
          cgst_amount: cgstAmount,
          sgst_rate: sgstRate,
          sgst_amount: sgstAmount,
          total_amount: totalAmount,
          amount_paid: amountPaid,
          balance_remaining: balanceRemaining,
          payment_reference: payment_reference.trim(),
          payment_method: payment_method || 'BANK_TRANSFER',
          payment_date: new Date().toISOString()
        };

        const pdfPath = await generateInvoicePDF(invoiceData);
        const relativePdf = `/invoices/${path.basename(pdfPath)}`;

        const info = db.prepare(`
          INSERT INTO invoices (
            invoice_number, fee_id, student_id, invoice_type, vendor_name, vendor_address, vendor_gstin,
            student_name, student_phone, student_email, description, subtotal, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
            total_amount, amount_paid, balance_remaining, payment_reference, payment_date, payment_method,
            pdf_path, email_sent, email_sent_to
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        `).run(
          invoiceNumber, fee.id, fee.student_id, 'GSTIN', vendorName, vendorAddress, vendorGstin,
          fee.student_name, fee.student_phone, fee.student_email, invoiceData.description, subtotal,
          cgstRate, cgstAmount, sgstRate, sgstAmount, totalAmount, amountPaid, balanceRemaining,
          payment_reference.trim(), new Date().toISOString(), payment_method || 'BANK_TRANSFER',
          relativePdf, fee.student_email
        );

        const newInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(info.lastInsertRowid);
        invoiceResult = { created: true, invoiceNumber, pdfPath: relativePdf };

        // Attempt WhatsApp delivery — idempotency: only send once per invoice
        if (fee.student_phone) {
          const pdfPublicUrl = process.env.APP_PUBLIC_URL
            ? `${process.env.APP_PUBLIC_URL}${relativePdf}`
            : null;

          whatsappResult = await sendWhatsAppInvoice({
            recipientPhone: fee.student_phone,
            studentName: fee.student_name,
            invoiceNumber,
            billingPeriod: fee.fee_type,
            totalAmount,
            amountPaid,
            balanceRemaining,
            pdfPath,
            pdfPublicUrl
          });

          db.prepare(`
            UPDATE invoices
            SET whatsapp_sent = ?, whatsapp_sent_at = CURRENT_TIMESTAMP,
                whatsapp_status = ?, whatsapp_error = ?, whatsapp_message_id = ?
            WHERE id = ?
          `).run(
            whatsappResult.success ? 1 : 0,
            whatsappResult.status || 'FAILED',
            whatsappResult.error || null,
            whatsappResult.messageId || null,
            newInvoice.id
          );
        }
      } else {
        invoiceResult = { created: false, invoiceNumber: existingInvoice.invoice_number, note: 'Invoice already existed.' };
      }
    } catch (invoiceErr) {
      console.error('Auto invoice generation error after payment verify:', invoiceErr.message);
      invoiceResult = { created: false, error: invoiceErr.message };
    }

    return res.json({
      message: 'Payment successfully verified and marked as Paid.',
      invoice: invoiceResult,
      whatsapp: whatsappResult
    });

  } else if (action === 'REJECT') {
    db.prepare(`
      UPDATE fee_records
      SET status = 'Failed',
          verified_by = ?,
          verified_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.session.user.username, fee.id);

    return res.json({ message: 'Payment verification rejected. Status set to Failed.' });
  } else {
    return res.status(400).json({ error: 'Invalid verification action. Use APPROVE or REJECT.' });
  }
});

// Upload Payment Evidence for Manual Verification (Management Only)
app.post('/api/fees/:id/evidence', requireManagement, upload.single('evidence'), (req, res) => {
  const fee = db.prepare('SELECT * FROM fee_records WHERE id = ?').get(req.params.id);
  if (!fee) return res.status(404).json({ error: 'Fee record not found.' });
  if (!req.file) return res.status(400).json({ error: 'No evidence file uploaded.' });

  const evidenceUrl = `/uploads/${req.file.filename}`;
  db.prepare(`
    UPDATE fee_records
    SET payment_evidence_url = ?,
        status = 'Verification Pending',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(evidenceUrl, fee.id);

  res.json({
    message: 'Payment evidence attached. Fee is now in "Verification Pending" state awaiting management review.',
    evidenceUrl
  });
});

// Send Fee Reminder (Management Only)
app.post('/api/fees/:id/remind', requireManagement, (req, res) => {
  const { channel = 'EMAIL', custom_message } = req.body;
  const fee = db.prepare(`
    SELECT f.*, s.name as student_name, s.phone, s.email, s.father_name, s.mother_name, s.admission_status
    FROM fee_records f
    JOIN students s ON s.id = f.student_id
    WHERE f.id = ?
  `).get(req.params.id);

  if (!fee) return res.status(404).json({ error: 'Fee record not found.' });

  if (fee.admission_status !== 'ACTIVE') {
    return res.status(400).json({ error: 'Cannot send reminders for inactive students.' });
  }
  if (fee.status === 'Paid') {
    return res.status(400).json({ error: 'Fee is already confirmed as Paid. Reminders cannot be sent for settled dues.' });
  }

  const recipient = channel === 'EMAIL' ? fee.email : fee.phone;
  if (!recipient) {
    return res.status(400).json({ error: `Student does not have a configured ${channel === 'EMAIL' ? 'Email ID' : 'Phone Number'}.` });
  }

  const defaultMsg = `Dear Parent/Student (${fee.student_name}),\n\nThis is a cordial fee reminder from Sridevi Nrithyalaya for ${fee.fee_type} of INR ${fee.amount.toFixed(2)} due by ${fee.due_date}.\nPlease complete the payment via bank transfer or the academy QR code.\n\nWarm regards,\nSridevi Nrithyalaya`;
  const messageToSend = custom_message || defaultMsg;

  db.prepare(`
    INSERT INTO fee_reminders (fee_id, student_id, channel, recipient_contact, message, status, sent_by_role)
    VALUES (?, ?, ?, ?, ?, 'SENT', 'MANAGEMENT')
  `).run(fee.id, fee.student_id, channel, recipient, messageToSend);

  res.json({
    message: `Reminder recorded for ${channel} to ${recipient}.`,
    channel,
    recipient
  });
});

// Get configuration status
app.get('/api/reminders/config-status', requireManagement, (req, res) => {
  const wa = getWhatsAppConfig();
  const mail = getEmailConfig();
  res.json({
    upiId: process.env.INSTITUTION_UPI_VPA || 'sridevinrithyalaya@indianbank',
    payeeName: process.env.INSTITUTION_NAME || 'Sridevi Nrithyalaya',
    whatsapp: {
      isConfigured: wa.isConfigured,
      phoneId: wa.phoneId ? 'Configured' : 'Missing',
      apiVersion: wa.apiVersion,
      templateName: wa.templateName,
      invoiceTemplateName: wa.invoiceTemplateName
    },
    email: {
      isConfigured: mail.isConfigured,
      host: mail.host ? mail.host : 'Missing',
      port: mail.port,
      fromEmail: mail.fromEmail,
      fromName: mail.fromName
    }
  });
});

// Preview eligible students for fee reminder broadcast (ACTIVE only)
app.get('/api/reminders/preview', requireManagement, (req, res) => {
  const { month, year } = req.query;
  const currentMonth = month || new Date().toLocaleString('en-IN', { month: 'long' });
  const currentYear = year || new Date().getFullYear().toString();
  const billingPeriod = `${currentMonth} ${currentYear}`;

  const fees = db.prepare(`
    SELECT f.*, s.id as student_id, s.name as student_name, s.phone as student_phone, s.email as student_email,
           s.father_name, s.mother_name, s.student_id_code, s.admission_status
    FROM fee_records f
    JOIN students s ON s.id = f.student_id
    WHERE s.admission_status = 'ACTIVE'
      AND f.status IN ('Pending', 'Overdue')
      AND (f.fee_type LIKE ? OR f.fee_type LIKE ?)
    ORDER BY s.name COLLATE NOCASE ASC
  `).all(`%${currentMonth}%${currentYear}%`, `%${currentMonth}%`);

  const eligibleStudents = [];
  const excludedStudents = [];
  let totalOutstanding = 0;
  let emailEligibleCount = 0;
  let whatsAppEligibleCount = 0;

  for (const fee of fees) {
    const outstanding = parseFloat(fee.amount) || 0;
    if (outstanding <= 0) continue;

    const hasValidEmail = isValidEmail(fee.student_email);
    const hasValidPhone = Boolean(formatWhatsAppPhone(fee.student_phone));

    const previousReminders = db.prepare(`
      SELECT channel, status, sent_at
      FROM fee_reminders
      WHERE student_id = ? AND fee_id = ? AND status = 'SENT'
    `).all(fee.student_id, fee.id);

    const emailAlreadySent = previousReminders.some(r => r.channel === 'EMAIL');
    const waAlreadySent = previousReminders.some(r => r.channel === 'WHATSAPP');

    const upiLink = generateUpiLink({
      amount: outstanding,
      studentName: fee.student_name,
      billingPeriod
    });

    if (!hasValidEmail && !hasValidPhone) {
      excludedStudents.push({
        studentId: fee.student_id,
        name: fee.student_name,
        code: fee.student_id_code,
        feeId: fee.id,
        outstanding,
        reason: 'Missing both valid email address and 10-digit mobile number'
      });
      continue;
    }

    if (hasValidEmail && !emailAlreadySent) emailEligibleCount++;
    if (hasValidPhone && !waAlreadySent) whatsAppEligibleCount++;
    totalOutstanding += outstanding;

    eligibleStudents.push({
      feeId: fee.id,
      studentId: fee.student_id,
      name: fee.student_name,
      code: fee.student_id_code,
      phone: fee.student_phone,
      email: fee.student_email,
      feeType: fee.fee_type,
      dueDate: fee.due_date,
      outstanding,
      hasValidEmail,
      hasValidPhone,
      emailAlreadySent,
      waAlreadySent,
      upiLink
    });
  }

  res.json({
    billingPeriod,
    month: currentMonth,
    year: currentYear,
    totalEligibleCount: eligibleStudents.length,
    totalOutstanding,
    emailEligibleCount,
    whatsAppEligibleCount,
    excludedCount: excludedStudents.length,
    eligibleStudents,
    excludedStudents
  });
});

// Broadcast Reminders — ACTIVE students only
app.post('/api/fees/broadcast-reminders', requireManagement, async (req, res) => {
  const { channel = 'ALL', month, year, retryFailed = false } = req.body;
  const currentMonth = month || new Date().toLocaleString('en-IN', { month: 'long' });
  const currentYear = year || new Date().getFullYear().toString();
  const billingPeriod = `${currentMonth} ${currentYear}`;
  const campaignId = `CAMP-${Date.now()}`;

  const pendingFees = db.prepare(`
    SELECT f.*, s.id as student_id, s.name as student_name, s.phone as student_phone, s.email as student_email,
           s.father_name, s.mother_name, s.student_id_code, s.admission_status
    FROM fee_records f
    JOIN students s ON s.id = f.student_id
    WHERE s.admission_status = 'ACTIVE'
      AND f.status IN ('Pending', 'Overdue')
      AND (f.fee_type LIKE ? OR f.fee_type LIKE ?)
    ORDER BY s.name COLLATE NOCASE ASC
  `).all(`%${currentMonth}%${currentYear}%`, `%${currentMonth}%`);

  if (pendingFees.length === 0) {
    return res.status(200).json({
      message: `No pending fee dues found for ${billingPeriod}. All student fees are currently settled!`,
      sentCount: 0,
      totalStudentsNotified: 0
    });
  }

  const results = [];
  let successfulSends = 0;
  let failedSends = 0;
  let skippedDuplicates = 0;
  let simulatedCount = 0;

  const insertReminder = db.prepare(`
    INSERT INTO fee_reminders (
      fee_id, student_id, channel, recipient_contact, message, status,
      billing_period, provider_message_id, error_details, upi_link, campaign_id, sent_by_role
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANAGEMENT')
  `);

  for (const fee of pendingFees) {
    const currentFee = db.prepare('SELECT status, amount FROM fee_records WHERE id = ?').get(fee.id);
    if (!currentFee || currentFee.status === 'Paid') {
      results.push({ student: fee.student_name, action: 'SKIPPED', reason: 'Payment settled immediately prior to dispatch' });
      continue;
    }

    const outstanding = currentFee.amount;
    const upiLink = generateUpiLink({ amount: outstanding, studentName: fee.student_name, billingPeriod });
    const defaultMsg = `Hello ${fee.father_name || fee.mother_name || fee.student_name}, this is a fee reminder from Sridevi Nrithyalaya. The outstanding fee for ${billingPeriod} is ₹${Number(outstanding).toFixed(2)}. Pay via UPI: sridevinrithyalaya@indianbank. If already paid, disregard this reminder. Thank you.`;

    // WhatsApp Channel
    if (channel === 'ALL' || channel === 'WHATSAPP') {
      const formattedPhone = formatWhatsAppPhone(fee.student_phone);
      if (!formattedPhone) {
        results.push({ student: fee.student_name, channel: 'WHATSAPP', status: 'SKIPPED', reason: 'Missing or invalid phone number' });
      } else {
        const existing = db.prepare(`SELECT id, status FROM fee_reminders WHERE student_id = ? AND fee_id = ? AND channel = 'WHATSAPP' AND status = 'SENT'`).get(fee.student_id, fee.id);
        if (existing && !retryFailed) {
          skippedDuplicates++;
          results.push({ student: fee.student_name, channel: 'WHATSAPP', status: 'SKIPPED', reason: 'Already successfully notified for this cycle' });
        } else {
          try {
            const sendRes = await sendWhatsAppReminder({ recipientPhone: formattedPhone, studentName: fee.student_name, billingPeriod, amount: outstanding, upiLink });
            insertReminder.run(fee.id, fee.student_id, 'WHATSAPP', formattedPhone, defaultMsg, sendRes.status, billingPeriod, sendRes.messageId || null, sendRes.error || null, upiLink, campaignId);
            if (sendRes.success) successfulSends++;
            else if (sendRes.simulated) simulatedCount++;
            else failedSends++;
            results.push({ student: fee.student_name, channel: 'WHATSAPP', status: sendRes.status, providerId: sendRes.messageId, error: sendRes.error });
          } catch (waErr) {
            failedSends++;
            insertReminder.run(fee.id, fee.student_id, 'WHATSAPP', formattedPhone, defaultMsg, 'FAILED', billingPeriod, null, waErr.message, upiLink, campaignId);
          }
        }
      }
    }

    // Email Channel
    if (channel === 'ALL' || channel === 'EMAIL') {
      if (!isValidEmail(fee.student_email)) {
        results.push({ student: fee.student_name, channel: 'EMAIL', status: 'SKIPPED', reason: 'Missing or invalid email address' });
      } else {
        const existingEmail = db.prepare(`SELECT id, status FROM fee_reminders WHERE student_id = ? AND fee_id = ? AND channel = 'EMAIL' AND status = 'SENT'`).get(fee.student_id, fee.id);
        if (existingEmail && !retryFailed) {
          skippedDuplicates++;
          results.push({ student: fee.student_name, channel: 'EMAIL', status: 'SKIPPED', reason: 'Already successfully emailed for this cycle' });
        } else {
          try {
            const sendRes = await sendEmailReminder({ recipientEmail: fee.student_email, studentName: fee.student_name, parentName: fee.father_name || fee.mother_name, billingPeriod, amount: outstanding, upiLink });
            insertReminder.run(fee.id, fee.student_id, 'EMAIL', fee.student_email, defaultMsg, sendRes.status, billingPeriod, sendRes.messageId || null, sendRes.error || null, upiLink, campaignId);
            if (sendRes.success) successfulSends++;
            else if (sendRes.simulated) simulatedCount++;
            else failedSends++;
            results.push({ student: fee.student_name, channel: 'EMAIL', status: sendRes.status, providerId: sendRes.messageId, error: sendRes.error });
          } catch (mailErr) {
            failedSends++;
            insertReminder.run(fee.id, fee.student_id, 'EMAIL', fee.student_email, defaultMsg, 'FAILED', billingPeriod, null, mailErr.message, upiLink, campaignId);
          }
        }
      }
    }
  }

  res.json({
    message: `Campaign complete for ${billingPeriod}: ${successfulSends} sent, ${simulatedCount} simulated (credentials pending in .env), ${failedSends} failed, ${skippedDuplicates} skipped as already sent.`,
    campaignId,
    billingPeriod,
    successfulSends,
    simulatedCount,
    failedSends,
    skippedDuplicates,
    details: results
  });
});

// ==========================================
// INVOICE GENERATION & PDF (Management Only)
// ==========================================

// Generate Invoice for Paid Fee
app.post('/api/invoices/generate', requireManagement, async (req, res) => {
  const { fee_id, invoice_type = 'GSTIN', custom_notes } = req.body;

  if (!fee_id) return res.status(400).json({ error: 'Fee record ID is required.' });

  const fee = db.prepare(`
    SELECT f.*, s.name as student_name, s.phone as student_phone, s.email as student_email,
           s.father_name, s.mother_name
    FROM fee_records f
    JOIN students s ON s.id = f.student_id
    WHERE f.id = ?
  `).get(fee_id);

  if (!fee) return res.status(404).json({ error: 'Fee record not found.' });

  if (fee.status !== 'Paid') {
    return res.status(400).json({
      error: `Invoices can only be generated for confirmed Paid fees. Current status is "${fee.status}". Please verify payment first.`
    });
  }

  // Prevent duplicate invoices for the same payment
  const existingInvoice = db.prepare('SELECT * FROM invoices WHERE fee_id = ?').get(fee.id);
  if (existingInvoice) {
    return res.json({
      message: 'Invoice already exists for this payment record.',
      invoice: existingInvoice
    });
  }

  const isGST = invoice_type.toUpperCase() === 'GSTIN';
  const totalAmount = fee.amount;
  const amountPaid = totalAmount;
  const balanceRemaining = 0;

  let subtotal = totalAmount;
  let cgstRate = 0, cgstAmount = 0, sgstRate = 0, sgstAmount = 0;

  if (isGST) {
    cgstRate = 9;
    sgstRate = 9;
    subtotal = parseFloat((totalAmount / 1.18).toFixed(2));
    cgstAmount = parseFloat((subtotal * 0.09).toFixed(2));
    sgstAmount = parseFloat((totalAmount - subtotal - cgstAmount).toFixed(2));
  }

  const yearStr = new Date().getFullYear();
  const nextYearStr = (yearStr + 1).toString().slice(2);
  const invoiceCount = db.prepare('SELECT COUNT(*) as count FROM invoices').get().count;
  const invoiceNumber = `SDN/${yearStr}-${nextYearStr}/${String(invoiceCount + 1).padStart(4, '0')}`;

  const vendorName = process.env.INSTITUTION_NAME || 'Sridevi Nrithyalaya';
  const vendorAddress = process.env.INSTITUTION_ADDRESS || 'New No. 19, Old No. 15, AVM Colony 1st Street, Kamarajar Salai, Virugambakkam, Chennai, Tamil Nadu 600092';
  const vendorGstin = isGST ? (process.env.INSTITUTION_GSTIN || '33AAAAA0000A1Z5') : null;

  const invoiceData = {
    invoice_number: invoiceNumber,
    fee_id: fee.id,
    student_id: fee.student_id,
    invoice_type: isGST ? 'GSTIN' : 'NON_GSTIN',
    vendor_name: vendorName,
    vendor_address: vendorAddress,
    vendor_gstin: vendorGstin,
    student_name: fee.student_name,
    student_phone: fee.student_phone,
    student_email: fee.student_email,
    description: fee.description || fee.fee_type,
    subtotal,
    cgst_rate: cgstRate,
    cgst_amount: cgstAmount,
    sgst_rate: sgstRate,
    sgst_amount: sgstAmount,
    total_amount: totalAmount,
    amount_paid: amountPaid,
    balance_remaining: balanceRemaining,
    payment_reference: fee.payment_reference,
    payment_date: fee.payment_date,
    payment_method: fee.payment_method
  };

  try {
    const pdfPath = await generateInvoicePDF(invoiceData);
    const relativePdf = `/invoices/${path.basename(pdfPath)}`;

    const info = db.prepare(`
      INSERT INTO invoices (
        invoice_number, fee_id, student_id, invoice_type, vendor_name, vendor_address, vendor_gstin,
        student_name, student_phone, student_email, description, subtotal, cgst_rate, cgst_amount, sgst_rate, sgst_amount,
        total_amount, amount_paid, balance_remaining, payment_reference, payment_date, payment_method,
        pdf_path, email_sent, email_sent_to
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      invoiceNumber, fee.id, fee.student_id, invoiceData.invoice_type, vendorName, vendorAddress, vendorGstin,
      fee.student_name, fee.student_phone, fee.student_email, invoiceData.description, subtotal,
      cgstRate, cgstAmount, sgstRate, sgstAmount, totalAmount, amountPaid, balanceRemaining,
      fee.payment_reference, fee.payment_date, fee.payment_method,
      relativePdf, fee.student_email
    );

    const created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({
      message: `Invoice ${invoiceNumber} generated successfully.`,
      invoice: created
    });
  } catch (err) {
    console.error('Invoice Generation Error:', err);
    res.status(500).json({ error: 'Failed to generate invoice PDF: ' + err.message });
  }
});

// List Invoices (Management Only)
app.get('/api/invoices', requireManagement, (req, res) => {
  const invoices = db.prepare('SELECT * FROM invoices ORDER BY id DESC').all();
  res.json({ invoices });
});

// Download Invoice PDF (Management Only)
app.get('/api/invoices/:id/pdf', requireManagement, async (req, res) => {
  try {
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice record not found.' });
    }

    let fullPath = invoice.pdf_path ? path.join(__dirname, '..', invoice.pdf_path) : null;

    if (!fullPath || !fs.existsSync(fullPath)) {
      const generatedPath = await generateInvoicePDF(invoice);
      const relativePdf = `/invoices/${path.basename(generatedPath)}`;
      db.prepare('UPDATE invoices SET pdf_path = ? WHERE id = ?').run(relativePdf, invoice.id);
      fullPath = generatedPath;
    }

    const downloadFilename = `Invoice_${invoice.invoice_number.replace(/[/\\?%*:|"<>]/g, '_')}.pdf`;
    res.download(fullPath, downloadFilename);
  } catch (err) {
    console.error('Invoice PDF Download Error:', err);
    res.status(500).json({ error: 'Could not generate or download invoice PDF: ' + err.message });
  }
});

// Resend invoice via WhatsApp (Management Only)
app.post('/api/invoices/:id/resend-whatsapp', requireManagement, async (req, res) => {
  try {
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    if (!invoice.student_phone) return res.status(400).json({ error: 'No phone number on record for this invoice.' });

    let fullPath = invoice.pdf_path ? path.join(__dirname, '..', invoice.pdf_path) : null;
    if (!fullPath || !fs.existsSync(fullPath)) {
      const generatedPath = await generateInvoicePDF(invoice);
      const relativePdf = `/invoices/${path.basename(generatedPath)}`;
      db.prepare('UPDATE invoices SET pdf_path = ? WHERE id = ?').run(relativePdf, invoice.id);
      fullPath = generatedPath;
    }

    const pdfPublicUrl = process.env.APP_PUBLIC_URL
      ? `${process.env.APP_PUBLIC_URL}${invoice.pdf_path}`
      : null;

    const result = await sendWhatsAppInvoice({
      recipientPhone: invoice.student_phone,
      studentName: invoice.student_name,
      invoiceNumber: invoice.invoice_number,
      billingPeriod: invoice.description,
      totalAmount: invoice.total_amount,
      amountPaid: invoice.amount_paid || invoice.total_amount,
      balanceRemaining: invoice.balance_remaining || 0,
      pdfPath: fullPath,
      pdfPublicUrl
    });

    db.prepare(`
      UPDATE invoices
      SET whatsapp_sent = ?, whatsapp_sent_at = CURRENT_TIMESTAMP,
          whatsapp_status = ?, whatsapp_error = ?, whatsapp_message_id = ?
      WHERE id = ?
    `).run(
      result.success ? 1 : 0,
      result.status || 'FAILED',
      result.error || null,
      result.messageId || null,
      invoice.id
    );

    res.json({
      message: result.success
        ? `Invoice ${invoice.invoice_number} sent to WhatsApp successfully.`
        : `WhatsApp send attempted (status: ${result.status}). ${result.error || ''}`,
      result
    });
  } catch (err) {
    console.error('WhatsApp resend error:', err);
    res.status(500).json({ error: 'Failed to resend invoice via WhatsApp: ' + err.message });
  }
});

// Fallback to Serve frontend app for any client-side routes
app.get('{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Sridevi Nrithyalaya Portal Server running on port ${PORT}`);
  console.log(` Web App URL: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
