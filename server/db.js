const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'sdn.db');
const db = new Database(dbPath);

// Enable WAL mode and foreign keys for high reliability and integrity
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('MANAGEMENT', 'FACULTY')),
      display_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    );

    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_code TEXT UNIQUE NOT NULL,
      batch_name TEXT NOT NULL,
      level TEXT NOT NULL,
      schedule TEXT NOT NULL,
      instructor TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 999,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      date_of_birth TEXT,
      age INTEGER,
      mother_tongue TEXT,
      father_name TEXT,
      mother_name TEXT,
      phone TEXT NOT NULL,
      email TEXT,
      parent_name TEXT,
      address TEXT,
      educational_qualification TEXT,
      previous_experience TEXT,
      photo_url TEXT,
      admission_status TEXT DEFAULT 'ACTIVE' CHECK(admission_status IN ('ACTIVE', 'INACTIVE', 'WITHDRAWN', 'ON_LEAVE')),
      leaving_reason TEXT,
      left_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
      enrolled_date DATE NOT NULL,
      status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'TRANSFERRED', 'WITHDRAWN')),
      notes TEXT,
      updated_by_role TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fee_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      fee_type TEXT NOT NULL,
      description TEXT,
      amount REAL NOT NULL,
      due_date DATE NOT NULL,
      status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending', 'Paid', 'Overdue', 'Verification Pending', 'Failed')),
      payment_method TEXT CHECK(payment_method IN ('QR_CODE', 'BANK_TRANSFER', 'ONLINE_LINK', 'CASH', NULL)),
      payment_reference TEXT,
      payment_evidence_url TEXT,
      payment_date DATETIME,
      verified_by TEXT,
      verified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fee_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fee_id INTEGER NOT NULL REFERENCES fee_records(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      channel TEXT NOT NULL CHECK(channel IN ('EMAIL', 'WHATSAPP')),
      recipient_contact TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('SENT', 'FAILED', 'SIMULATED')),
      billing_period TEXT,
      provider_message_id TEXT,
      error_details TEXT,
      upi_link TEXT,
      campaign_id TEXT,
      sent_by_role TEXT NOT NULL,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      fee_id INTEGER NOT NULL REFERENCES fee_records(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      invoice_type TEXT NOT NULL CHECK(invoice_type IN ('GSTIN', 'NON_GSTIN')),
      vendor_name TEXT NOT NULL,
      vendor_address TEXT NOT NULL,
      vendor_gstin TEXT,
      student_name TEXT NOT NULL,
      student_phone TEXT,
      student_email TEXT,
      description TEXT NOT NULL,
      subtotal REAL NOT NULL,
      cgst_rate REAL DEFAULT 0,
      cgst_amount REAL DEFAULT 0,
      sgst_rate REAL DEFAULT 0,
      sgst_amount REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      amount_paid REAL,
      balance_remaining REAL,
      payment_reference TEXT,
      payment_date DATETIME,
      payment_method TEXT,
      pdf_path TEXT,
      email_sent INTEGER DEFAULT 0,
      email_sent_to TEXT,
      whatsapp_sent INTEGER DEFAULT 0,
      whatsapp_sent_at DATETIME,
      whatsapp_status TEXT,
      whatsapp_error TEXT,
      whatsapp_message_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_students_name ON students(name);
    CREATE INDEX IF NOT EXISTS idx_students_phone ON students(phone);
    CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);
    CREATE INDEX IF NOT EXISTS idx_students_status ON students(admission_status);
    CREATE INDEX IF NOT EXISTS idx_fee_status ON fee_records(status);
    CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_fee ON fee_reminders(fee_id);
  `);

  // ── Safe migrations for existing databases ──────────────────────────────────
  // fee_reminders columns
  try { db.exec(`ALTER TABLE fee_reminders ADD COLUMN billing_period TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE fee_reminders ADD COLUMN provider_message_id TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE fee_reminders ADD COLUMN error_details TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE fee_reminders ADD COLUMN upi_link TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE fee_reminders ADD COLUMN campaign_id TEXT`); } catch(e){}

  // students – new enrollment form fields
  try { db.exec(`ALTER TABLE students ADD COLUMN date_of_birth TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE students ADD COLUMN mother_tongue TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE students ADD COLUMN father_name TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE students ADD COLUMN mother_name TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE students ADD COLUMN educational_qualification TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE students ADD COLUMN previous_experience TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE students ADD COLUMN leaving_reason TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE students ADD COLUMN left_at DATETIME`); } catch(e){}
  // Keep admission_fee_paid column for historical data – never set for new students
  try { db.exec(`ALTER TABLE students ADD COLUMN admission_fee_paid INTEGER DEFAULT 0`); } catch(e){}

  // Ensure students table schema supports 'INACTIVE' and optional email
  try {
    const studentsTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='students'").get();
    if (studentsTableSql && (!studentsTableSql.sql.includes("'INACTIVE'") || studentsTableSql.sql.includes("email TEXT NOT NULL"))) {
      db.pragma('foreign_keys = OFF');
      db.exec(`
        BEGIN TRANSACTION;
        ALTER TABLE students RENAME TO students_backup;

        CREATE TABLE students (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id_code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          date_of_birth TEXT,
          age INTEGER,
          mother_tongue TEXT,
          father_name TEXT,
          mother_name TEXT,
          phone TEXT NOT NULL,
          email TEXT,
          parent_name TEXT,
          address TEXT,
          educational_qualification TEXT,
          previous_experience TEXT,
          photo_url TEXT,
          admission_status TEXT DEFAULT 'ACTIVE' CHECK(admission_status IN ('ACTIVE', 'INACTIVE', 'WITHDRAWN', 'ON_LEAVE')),
          leaving_reason TEXT,
          left_at DATETIME,
          admission_fee_paid INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO students (
          id, student_id_code, name, date_of_birth, age, mother_tongue, father_name, mother_name,
          phone, email, parent_name, address, educational_qualification, previous_experience, photo_url,
          admission_status, leaving_reason, left_at, admission_fee_paid, created_at, updated_at
        )
        SELECT
          id, student_id_code, name, date_of_birth, age, mother_tongue, father_name, mother_name,
          phone, email, parent_name, address, educational_qualification, previous_experience, photo_url,
          admission_status, leaving_reason, left_at, COALESCE(admission_fee_paid, 0), created_at, updated_at
        FROM students_backup;

        DROP TABLE students_backup;
        COMMIT;
      `);
      db.pragma('foreign_keys = ON');
    }
  } catch (err) {
    console.error('Students table schema migration error:', err);
    try { db.exec('ROLLBACK'); } catch(e){}
    db.pragma('foreign_keys = ON');
  }

  // Fix any tables that were renamed to reference students_backup
  try {
    const backupRefs = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%students_backup%'").all();
    if (backupRefs.length > 0) {
      db.pragma('foreign_keys = OFF');
      db.exec('BEGIN TRANSACTION;');

      for (const t of backupRefs) {
        if (t.name === 'enrollments') {
          db.exec(`
            CREATE TABLE enrollments_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
              batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
              enrolled_date DATE NOT NULL,
              status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'TRANSFERRED', 'WITHDRAWN')),
              notes TEXT,
              updated_by_role TEXT NOT NULL,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO enrollments_new SELECT * FROM enrollments;
            DROP TABLE enrollments;
            ALTER TABLE enrollments_new RENAME TO enrollments;
          `);
        } else if (t.name === 'fee_records') {
          db.exec(`
            CREATE TABLE fee_records_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
              fee_type TEXT NOT NULL,
              description TEXT,
              amount REAL NOT NULL,
              due_date DATE NOT NULL,
              status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending', 'Paid', 'Overdue', 'Verification Pending', 'Failed')),
              payment_method TEXT CHECK(payment_method IN ('QR_CODE', 'BANK_TRANSFER', 'ONLINE_LINK', 'CASH', NULL)),
              payment_reference TEXT,
              payment_evidence_url TEXT,
              payment_date DATETIME,
              verified_by TEXT,
              verified_at DATETIME,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO fee_records_new SELECT * FROM fee_records;
            DROP TABLE fee_records;
            ALTER TABLE fee_records_new RENAME TO fee_records;
          `);
        } else if (t.name === 'fee_reminders') {
          db.exec(`
            CREATE TABLE fee_reminders_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              fee_id INTEGER NOT NULL REFERENCES fee_records(id) ON DELETE CASCADE,
              student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
              channel TEXT NOT NULL CHECK(channel IN ('EMAIL', 'WHATSAPP')),
              recipient_contact TEXT NOT NULL,
              message TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('SENT', 'FAILED', 'SIMULATED')),
              billing_period TEXT,
              provider_message_id TEXT,
              error_details TEXT,
              upi_link TEXT,
              campaign_id TEXT,
              sent_by_role TEXT NOT NULL,
              sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO fee_reminders_new (
              id, fee_id, student_id, channel, recipient_contact, message, status,
              billing_period, provider_message_id, error_details, upi_link, campaign_id,
              sent_by_role, sent_at
            ) SELECT
              id, fee_id, student_id, channel, recipient_contact, message, status,
              billing_period, provider_message_id, error_details, upi_link, campaign_id,
              sent_by_role, sent_at
            FROM fee_reminders;
            DROP TABLE fee_reminders;
            ALTER TABLE fee_reminders_new RENAME TO fee_reminders;
          `);
        } else if (t.name === 'invoices') {
          db.exec(`
            CREATE TABLE invoices_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              invoice_number TEXT UNIQUE NOT NULL,
              fee_id INTEGER NOT NULL REFERENCES fee_records(id) ON DELETE CASCADE,
              student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
              invoice_type TEXT NOT NULL CHECK(invoice_type IN ('GSTIN', 'NON_GSTIN')),
              vendor_name TEXT NOT NULL,
              vendor_address TEXT NOT NULL,
              vendor_gstin TEXT,
              student_name TEXT NOT NULL,
              student_phone TEXT,
              student_email TEXT,
              description TEXT NOT NULL,
              subtotal REAL NOT NULL,
              cgst_rate REAL DEFAULT 0,
              cgst_amount REAL DEFAULT 0,
              sgst_rate REAL DEFAULT 0,
              sgst_amount REAL DEFAULT 0,
              total_amount REAL NOT NULL,
              amount_paid REAL,
              balance_remaining REAL,
              payment_reference TEXT,
              payment_date DATETIME,
              payment_method TEXT,
              pdf_path TEXT,
              email_sent INTEGER DEFAULT 0,
              email_sent_to TEXT,
              whatsapp_sent INTEGER DEFAULT 0,
              whatsapp_sent_at DATETIME,
              whatsapp_status TEXT,
              whatsapp_error TEXT,
              whatsapp_message_id TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO invoices_new (
              id, invoice_number, fee_id, student_id, invoice_type, vendor_name, vendor_address, vendor_gstin,
              student_name, student_phone, student_email, description, subtotal, cgst_rate, cgst_amount,
              sgst_rate, sgst_amount, total_amount, amount_paid, balance_remaining, payment_reference,
              payment_date, payment_method, pdf_path, email_sent, email_sent_to, whatsapp_sent,
              whatsapp_sent_at, whatsapp_status, whatsapp_error, whatsapp_message_id, created_at
            ) SELECT
              id, invoice_number, fee_id, student_id, invoice_type, vendor_name, vendor_address, vendor_gstin,
              student_name, student_phone, student_email, description, subtotal, cgst_rate, cgst_amount,
              sgst_rate, sgst_amount, total_amount, amount_paid, balance_remaining, payment_reference,
              payment_date, payment_method, pdf_path, email_sent, email_sent_to, whatsapp_sent,
              whatsapp_sent_at, whatsapp_status, whatsapp_error, whatsapp_message_id, created_at
            FROM invoices;
            DROP TABLE invoices;
            ALTER TABLE invoices_new RENAME TO invoices;
          `);
        }
      }
      db.exec('COMMIT;');
      db.pragma('foreign_keys = ON');
    }
  } catch(err) {
    console.error('Error fixing foreign key references:', err);
    try { db.exec('ROLLBACK;'); } catch(e){}
    db.pragma('foreign_keys = ON');
  }

  // invoices – WhatsApp delivery tracking
  try { db.exec(`ALTER TABLE invoices ADD COLUMN amount_paid REAL`); } catch(e){}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN balance_remaining REAL`); } catch(e){}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN payment_method TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN whatsapp_sent INTEGER DEFAULT 0`); } catch(e){}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN whatsapp_sent_at DATETIME`); } catch(e){}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN whatsapp_status TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN whatsapp_error TEXT`); } catch(e){}
  try { db.exec(`ALTER TABLE invoices ADD COLUMN whatsapp_message_id TEXT`); } catch(e){}

  // batches – raise default capacity (no limit enforced now)
  try { db.exec(`UPDATE batches SET capacity = 999 WHERE capacity < 999`); } catch(e){}

  // Indexes
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reminders_student_period ON fee_reminders(student_id, billing_period, channel)`);
  } catch(e){}
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_students_status ON students(admission_status)`);
  } catch(e){}

  seedDefaultData();
}

function seedDefaultData() {
  const mgmtUser = process.env.MANAGEMENT_SHARED_USER || 'Admin';
  const mgmtPass = process.env.MANAGEMENT_SHARED_PASS || 'AdminSDN@123';
  const facultyUser = process.env.FACULTY_SHARED_USER || 'SDNFaculty';
  const facultyPass = process.env.FACULTY_SHARED_PASS || 'FacultySDN@123';

  const checkUser = db.prepare('SELECT id, password_hash FROM users WHERE username = ?');

  // Seed / update shared Management user
  const existingMgmt = checkUser.get(mgmtUser);
  const mgmtHash = bcrypt.hashSync(mgmtPass, 10);
  if (!existingMgmt) {
    db.prepare(`
      INSERT INTO users (username, password_hash, role, display_name)
      VALUES (?, ?, 'MANAGEMENT', 'Management Team')
    `).run(mgmtUser, mgmtHash);
  } else {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(mgmtHash, existingMgmt.id);
  }

  // Seed / update shared Faculty user
  const existingFaculty = checkUser.get(facultyUser);
  const facultyHash = bcrypt.hashSync(facultyPass, 10);
  if (!existingFaculty) {
    db.prepare(`
      INSERT INTO users (username, password_hash, role, display_name)
      VALUES (?, ?, 'FACULTY', 'Full-Time Faculty')
    `).run(facultyUser, facultyHash);
  } else {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(facultyHash, existingFaculty.id);
  }

  // NOTE: Enrollment and Batches starts with zero predefined data as explicitly requested.
  // Batches will be created organically by Management via the "+ Add New Batch" interface.
}

module.exports = {
  db,
  initDb
};
