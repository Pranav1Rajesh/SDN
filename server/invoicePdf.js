const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const invoicesDir = path.join(__dirname, '..', 'invoices');
if (!fs.existsSync(invoicesDir)) {
  fs.mkdirSync(invoicesDir, { recursive: true });
}

function generateInvoicePDF(invoiceData) {
  return new Promise((resolve, reject) => {
    try {
      const sanitizedNum = invoiceData.invoice_number.replace(/[/\\?%*:|"<>]/g, '_');
      const filename = `Invoice_${sanitizedNum}.pdf`;
      const filePath = path.join(invoicesDir, filename);

      const doc = new PDFDocument({ margin: 45, size: 'A4' });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Color tokens from SDN branding
      const primaryRed = '#d10807';
      const deepMaroon = '#8b0000';
      const goldAccent = '#b38f28';
      const darkText = '#1f1f1f';
      const mutedText = '#666666';

      // Decorative top border
      doc.rect(45, 30, 505, 5).fill(primaryRed);

      // Header: SDN Title
      doc.fillColor(primaryRed).fontSize(20).font('Helvetica-Bold').text('SRIDEVI NRITHYALAYA', 45, 45);
      doc.fillColor(mutedText).fontSize(8.5).font('Helvetica')
        .text(invoiceData.vendor_address || process.env.INSTITUTION_ADDRESS || 'New No. 19, Old No. 15, AVM Colony 1st Street, Kamarajar Salai, Virugambakkam, Chennai, Tamil Nadu 600092', 45, 82, { width: 300 });

      // Invoice Badge / Title
      const isGST = invoiceData.invoice_type === 'GSTIN';
      const invoiceTitle = isGST ? 'TAX INVOICE' : 'RECEIPT / INVOICE';
      
      doc.rect(380, 45, 170, 30).fill(primaryRed);
      doc.fillColor('#ffffff').fontSize(12).font('Helvetica-Bold').text(invoiceTitle, 380, 54, { width: 170, align: 'center' });

      // Invoice Meta Table Box
      doc.roundedRect(380, 80, 170, 70, 3).stroke(primaryRed);
      doc.fillColor(darkText).fontSize(8.5).font('Helvetica-Bold').text('Invoice No:', 388, 88);
      doc.font('Helvetica').text(invoiceData.invoice_number, 448, 88);

      doc.font('Helvetica-Bold').text('Date:', 388, 103);
      doc.font('Helvetica').text(new Date(invoiceData.created_at || Date.now()).toLocaleDateString('en-IN'), 448, 103);

      doc.font('Helvetica-Bold').text('Type:', 388, 118);
      doc.font('Helvetica').text(isGST ? 'GST Tax Invoice' : 'Non-GST Bill', 448, 118);

      if (isGST && invoiceData.vendor_gstin) {
        doc.font('Helvetica-Bold').text('Vendor GST:', 388, 133);
        doc.font('Helvetica').text(invoiceData.vendor_gstin, 448, 133);
      }

      // Separator Line
      doc.moveTo(45, 160).lineTo(550, 160).strokeColor('#e5e5e5').stroke();

      // Billed To Section
      doc.fillColor(deepMaroon).fontSize(11).font('Helvetica-Bold').text('BILLED TO (STUDENT / PARENT)', 45, 175);
      doc.fillColor(darkText).fontSize(10).font('Helvetica-Bold').text(invoiceData.student_name, 45, 192);
      
      let nextY = 207;
      if (invoiceData.student_phone) {
        doc.fillColor(mutedText).fontSize(9).font('Helvetica').text(`WhatsApp/Phone: ${invoiceData.student_phone}`, 45, nextY);
        nextY += 14;
      }
      if (invoiceData.student_email) {
        doc.fillColor(mutedText).fontSize(9).font('Helvetica').text(`Email: ${invoiceData.student_email}`, 45, nextY);
        nextY += 14;
      }
      if (invoiceData.payment_reference) {
        doc.fillColor(mutedText).fontSize(9).font('Helvetica').text(`Payment Ref: ${invoiceData.payment_reference}`, 45, nextY);
        nextY += 14;
      }

      // Itemized Table Header
      const tableTop = 265;
      doc.rect(45, tableTop, 505, 24).fill('#f9f9f9');
      doc.rect(45, tableTop, 505, 24).stroke(primaryRed);

      doc.fillColor(primaryRed).fontSize(9).font('Helvetica-Bold');
      doc.text('S.NO', 55, tableTop + 7);
      doc.text('FEE DESCRIPTION', 95, tableTop + 7);
      doc.text('SAC / CODE', 310, tableTop + 7);
      doc.text('RATE (INR)', 390, tableTop + 7, { width: 60, align: 'right' });
      doc.text('AMOUNT (INR)', 470, tableTop + 7, { width: 70, align: 'right' });

      // Table Content Row
      const rowY = tableTop + 30;
      doc.fillColor(darkText).fontSize(9).font('Helvetica');
      doc.text('1', 55, rowY);
      doc.font('Helvetica-Bold').text(invoiceData.description, 95, rowY, { width: 205 });
      doc.font('Helvetica').text(isGST ? '9992' : 'N/A', 310, rowY);
      doc.text(invoiceData.subtotal.toFixed(2), 390, rowY, { width: 60, align: 'right' });
      doc.text(invoiceData.subtotal.toFixed(2), 470, rowY, { width: 70, align: 'right' });

      doc.moveTo(45, rowY + 35).lineTo(550, rowY + 35).strokeColor('#e5e5e5').stroke();

      // Calculations Box
      let calcY = rowY + 45;
      const labelX = 350;
      const valX = 460;

      doc.fontSize(9).font('Helvetica');
      doc.text('Subtotal:', labelX, calcY);
      doc.text(`INR ${invoiceData.subtotal.toFixed(2)}`, valX, calcY, { width: 80, align: 'right' });
      calcY += 16;

      if (isGST) {
        doc.text(`CGST (${invoiceData.cgst_rate}%):`, labelX, calcY);
        doc.text(`INR ${invoiceData.cgst_amount.toFixed(2)}`, valX, calcY, { width: 80, align: 'right' });
        calcY += 16;

        doc.text(`SGST (${invoiceData.sgst_rate}%):`, labelX, calcY);
        doc.text(`INR ${invoiceData.sgst_amount.toFixed(2)}`, valX, calcY, { width: 80, align: 'right' });
        calcY += 16;
      }

      // Total Box
      doc.rect(340, calcY, 210, 26).fill(primaryRed);
      doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold');
      doc.text('TOTAL AMOUNT:', 350, calcY + 8);
      doc.text(`INR ${invoiceData.total_amount.toFixed(2)}`, valX - 10, calcY + 8, { width: 80, align: 'right' });
      calcY += 36;

      // Amount Paid / Balance Remaining rows (if applicable)
      const amountPaid = invoiceData.amount_paid != null ? invoiceData.amount_paid : invoiceData.total_amount;
      const balanceRemaining = invoiceData.balance_remaining != null ? invoiceData.balance_remaining : 0;

      doc.fillColor(darkText).fontSize(9).font('Helvetica');
      doc.text('Amount Paid:', labelX, calcY);
      doc.text(`INR ${Number(amountPaid).toFixed(2)}`, valX, calcY, { width: 80, align: 'right' });
      calcY += 16;

      if (balanceRemaining > 0) {
        doc.fillColor('#b45309').font('Helvetica-Bold');
        doc.text('Balance Due:', labelX, calcY);
        doc.text(`INR ${Number(balanceRemaining).toFixed(2)}`, valX, calcY, { width: 80, align: 'right' });
        calcY += 16;
        doc.fillColor(darkText).font('Helvetica');
      }

      // Payment Status Stamp
      const stampY = calcY + 14;
      const isFullyPaid = balanceRemaining <= 0;
      const stampColor = isFullyPaid ? '#2e7d32' : '#b45309';
      const stampText = isFullyPaid ? 'PAYMENT VERIFIED & PAID IN FULL' : 'PARTIAL PAYMENT RECEIVED';

      doc.roundedRect(45, stampY, 220, 45, 4).strokeColor(stampColor).stroke();
      doc.fillColor(stampColor).fontSize(10).font('Helvetica-Bold').text(stampText, 55, stampY + 10);
      doc.fontSize(8).font('Helvetica').text(`Method: ${invoiceData.payment_method || 'Verified'}`, 55, stampY + 25);

      // Terms & Authorized Signatory
      const footerY = 660;
      doc.fillColor(mutedText).fontSize(8).font('Helvetica')
        .text('This is a computer generated invoice/receipt issued by Sridevi Nrithyalaya.', 45, footerY)
        .text('Monthly tuition fees once paid are subject to institutional guidelines.', 45, footerY + 12)
        .text(`For queries, contact ${process.env.INSTITUTION_EMAIL || 'contact@sridevinrithyalaya.org'} or call ${process.env.INSTITUTION_PHONE || '+91 98405 35825'}.`, 45, footerY + 24);

      doc.fillColor(darkText).fontSize(9).font('Helvetica-Bold')
        .text('For SRIDEVI NRITHYALAYA', 390, footerY)
        .text('Authorized Signatory', 390, footerY + 36);

      // Bottom Bar
      doc.rect(45, 760, 505, 3).fill(goldAccent);

      doc.end();

      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  generateInvoicePDF,
  invoicesDir
};
