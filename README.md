# Sridevi Nrithyalaya — Management & Faculty Portal

A secure, functional student administration and faculty management portal for **Sridevi Nrithyalaya (SDN)** ([https://sridevinrithyalaya.org/](https://sridevinrithyalaya.org/)), the world-renowned Bharatanatyam dance institution founded by Guru Dr. Sheela Unnikrishnan.

---

## 1. Features Implemented

### Authentication & Role Permissions
- **Two Shared Login Types**:
  - **Management Team** (Sheela, Shobha, Srividya): Full institutional access.
  - **Full-Time Faculty**: Restricted access to Student Enrollment & Batch Allocations only.
- **Server-Side Role Protection**: Express session middleware strictly blocks faculty from financial APIs, payment verification, fee records, and invoices.
- **Secure Password Hashing**: Passwords securely hashed with `bcryptjs`.

### Management Dashboard
- Real database-driven statistics (Total registered students, active enrollments, pending fees, completed fees, overdue fees, and verification pending count).
- Recent student registrations and recent payment activities feed.

### Student Onboarding Portal
- **Strict Mandatory Validation** on starred fields (*Student Name*, *Age*, *Phone Number*, *Email ID*) on both frontend and backend.
- Optional secondary fields: Parent Name, Residential Address, Student Photo.
- **In-Person Bank QR Admission Fee Workflow**: Generates institutional UPI details (`sridevinrithyalaya@indianbank`), records UTR transaction references, and places payments into `Verification Pending` state.
- **Excel / CSV Bulk Student Import**: Safe import for existing students with duplicate phone/email detection, data validation, and pre-commit preview.

### Student Management Portal
- Searchable and manageable student table with real-time search across names, phone numbers, and emails.
- Pagination, profile modal view, and student information editing.

### Fee Management & Reminders
- Complete fee status tracking (`Pending`, `Verification Pending`, `Paid`, `Overdue`, `Failed`).
- **Payment Verification Workflow**: Management can review UTR references, inspect payment evidence, and approve/reject transactions without blindly trusting screenshots.
- **Fee Reminders**: Cordial automated reminders dispatchable via configured Email and WhatsApp/SMS with duplicate prevention.

### Enrollment & Batch Management
- Real-time batch allocations across classical SDN curriculum tiers (Beginner - Salangai Pooja, Intermediate - Bala Margam, Advanced - Margam Intensive, Professional - Arangetram Coaching).
- Faculty can view student lists and update batch assignments.

### Invoice Generation Portal
- **GSTIN Toggle**: Interactive toggle switch between **With GSTIN** (Tax Invoice with 9% CGST + 9% SGST breakdown) and **Without GSTIN** (Receipt/Bill).
- Automated unique invoice numbering (`SDN/YYYY-YY/XXXX`).
- Native server-side PDF generation (`pdfkit`) with one-click download.

---

## 2. Configuration & Shared Credentials

Credentials and institution details are configured in `.env` (a template is provided in `.env.example`):

```ini
PORT=5000
SESSION_SECRET=sdn_secret_key_session_chennai_bharatanatyam_2026

# Shared Management Credentials
MANAGEMENT_SHARED_USER=Admin
MANAGEMENT_SHARED_PASS=AdminSDN@123

# Shared Full-Time Faculty Credentials
FACULTY_SHARED_USER=SDNFaculty
FACULTY_SHARED_PASS=FacultySDN@123

# Institution Details
INSTITUTION_NAME=Sri Devi Nrithyalaya
INSTITUTION_ADDRESS=No. 11/5, 1st Cross Street, Trustpuram, Kodambakkam, Chennai, Tamil Nadu 600024
INSTITUTION_GSTIN=33AAAAA0000A1Z5
INSTITUTION_EMAIL=contact@sridevinrithyalaya.org
INSTITUTION_PHONE=+91 98401 23456
INSTITUTION_UPI_VPA=sridevinrithyalaya@indianbank
```

---

## 3. Running & Testing the Portal

### Run Locally
```bash
npm start
```
Open **[http://localhost:5000](http://localhost:5000)** in any browser.

### Run Automated Test Suite
```bash
node test_suite.js
```
The test suite validates database tables, foreign keys, mandatory field constraints, shared credentials, and invoice tax calculations.
