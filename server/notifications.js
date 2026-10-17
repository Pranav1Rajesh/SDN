
const https = require('https');
const fs = require('fs');
const nodemailer = require('nodemailer');

/**
 * Generate standard, URL-encoded UPI deep-link.
 */
function generateUpiLink({
  upiId = process.env.INSTITUTION_UPI_VPA || 'sridevinrithyalaya@indianbank',
  payeeName = 'Sridevi Nrithyalaya',
  amount,
  studentName,
  billingPeriod,
  reference
}) {
  const cleanAmount = Number(amount).toFixed(2);
  const note = `${studentName} - Fee ${billingPeriod}`;
  const ref = reference || `SDN${Date.now().toString(36).toUpperCase()}`;

  const params = new URLSearchParams();
  params.set('pa', upiId);
  params.set('pn', payeeName);
  params.set('am', cleanAmount);
  params.set('cu', 'INR');
  params.set('tn', note);
  params.set('tr', ref);

  return `upi://pay?${params.toString()}`;
}

/**
 * Format recipient phone number.
 */
function formatWhatsAppPhone(phone) {
  if (!phone) return null;

  const digits = phone.toString().replace(/\D/g, '');

  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;

  if (digits.length >= 10 && digits.length <= 15) return digits;

  return null;
}

/**
 * Generate a free WhatsApp Click-to-Chat link.
 * Opens WhatsApp with a prefilled message; the user must press Send.
 */
function generateWhatsAppLink({ recipientPhone, message }) {
  const formattedPhone = formatWhatsAppPhone(recipientPhone);

  if (!formattedPhone) {
    return {
      success: false,
      status: 'FAILED',
      error: 'Invalid recipient WhatsApp number'
    };
  }

  if (!message || typeof message !== 'string') {
    return {
      success: false,
      status: 'FAILED',
      error: 'WhatsApp message is required'
    };
  }

  return {
    success: true,
    status: 'PREPARED',
    url: `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`,
    phone: formattedPhone
  };
}

/**
 * Generate a personalized WhatsApp fee reminder link.
 */
function generateWhatsAppReminderLink({
  recipientPhone,
  studentName,
  parentName,
  billingPeriod,
  amount,
  upiLink,
  upiId = process.env.INSTITUTION_UPI_VPA || 'sridevinrithyalaya@indianbank'
}) {
  const recipient = parentName ? `Parent/Guardian of ${studentName}` : studentName;

  const message = [
    `Dear ${recipient},`,
    '',
    `This is a fee reminder from Sridevi Nrithyalaya for ${billingPeriod}.`,
    `Student: ${studentName}`,
    `Outstanding Amount: ₹${Number(amount).toFixed(2)}`,
    '',
    `UPI ID: ${upiId}`,
    `Payment Link: ${upiLink}`,
    '',
    'If you have already paid, please disregard this reminder.',
    '',
    'Regards,',
    'Sridevi Nrithyalaya'
  ].join('\n');

  return generateWhatsAppLink({ recipientPhone, message });
}

/**
 * Generate a WhatsApp link for sharing an invoice.
 * The PDF must be attached/shared manually unless an API is configured.
 */
function generateWhatsAppInvoiceLink({
  recipientPhone,
  studentName,
  invoiceNumber,
  billingPeriod,
  totalAmount,
  amountPaid,
  balanceRemaining,
  pdfPublicUrl
}) {
  const paid = Number(amountPaid ?? totalAmount ?? 0);
  const balance = Number(balanceRemaining ?? 0);

  const message = [
    `Dear ${studentName},`,
    '',
    `Your invoice from Sridevi Nrithyalaya is ready.`,
    `Invoice Number: ${invoiceNumber}`,
    `Billing Period: ${billingPeriod}`,
    `Invoice Amount: ₹${Number(totalAmount || 0).toFixed(2)}`,
    `Amount Paid: ₹${paid.toFixed(2)}`,
    `Balance Due: ₹${balance.toFixed(2)}`,
    pdfPublicUrl ? `Invoice PDF: ${pdfPublicUrl}` : 'Please request the invoice PDF from the academy.',
    '',
    'Regards,',
    'Sridevi Nrithyalaya'
  ].join('\n');

  return generateWhatsAppLink({ recipientPhone, message });
}

/**
 * Validate email format.
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Get configured WhatsApp service status and settings.
 */
function getWhatsAppConfig() {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'fee_reminder_sdn';
  const invoiceTemplateName = process.env.WHATSAPP_INVOICE_TEMPLATE_NAME || 'invoice_delivery_sdn';
  const templateLang = process.env.WHATSAPP_TEMPLATE_LANG || 'en';

  const isConfigured = Boolean(
    token &&
    phoneId &&
    token !== 'placeholder' &&
    phoneId !== 'placeholder' &&
    token !== 'your_meta_system_user_permanent_access_token_here' &&
    phoneId !== 'your_meta_phone_number_id_here'
  );

  return {
    isConfigured,
    phoneId,
    apiVersion,
    templateName,
    invoiceTemplateName,
    templateLang
  };
}

/**
 * Get configured Email (SMTP) service status and settings.
 */
function getEmailConfig() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USERNAME;
  const pass = process.env.SMTP_PASSWORD;
  const fromEmail = process.env.SMTP_FROM_EMAIL || 'contact@sridevinrithyalaya.org';
  const fromName = process.env.SMTP_FROM_NAME || 'Sridevi Nrithyalaya';

  const isConfigured = Boolean(host && user && pass && host !== 'placeholder');

  return {
    isConfigured,
    host,
    port,
    fromEmail,
    fromName
  };
}

/**
 * Send WhatsApp reminder through Meta Cloud API when configured.
 * Otherwise return a Click-to-Chat link for manual sending.
 */
async function sendWhatsAppReminder({
  recipientPhone,
  studentName,
  parentName,
  billingPeriod,
  amount,
  upiLink
}) {
  const config = getWhatsAppConfig();
  const formattedPhone = formatWhatsAppPhone(recipientPhone);

  if (!formattedPhone) {
    return {
      success: false,
      status: 'FAILED',
      error: 'Invalid recipient phone number format'
    };
  }

  if (!config.isConfigured) {
    const prepared = generateWhatsAppReminderLink({
      recipientPhone,
      studentName,
      parentName,
      billingPeriod,
      amount,
      upiLink
    });

    return {
      ...prepared,
      simulated: false,
      manualSendRequired: true,
      error: prepared.success
        ? null
        : prepared.error
    };
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: formattedPhone,
    type: 'template',
    template: {
      name: config.templateName,
      language: { code: config.templateLang },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: studentName },
            { type: 'text', text: billingPeriod },
            { type: 'text', text: Number(amount).toFixed(2) },
            { type: 'text', text: upiLink }
          ]
        }
      ]
    }
  };

  return sendMetaWhatsAppRequest(config, payload, 15000);
}

/**
 * Send invoice PDF through Meta API when configured.
 * Without API credentials, prepare a Click-to-Chat link.
 */
async function sendWhatsAppInvoice({
  recipientPhone,
  studentName,
  invoiceNumber,
  billingPeriod,
  totalAmount,
  amountPaid,
  balanceRemaining,
  pdfPath,
  pdfPublicUrl
}) {
  const config = getWhatsAppConfig();
  const formattedPhone = formatWhatsAppPhone(recipientPhone);

  if (!formattedPhone) {
    return {
      success: false,
      status: 'FAILED',
      error: 'Invalid recipient phone number format'
    };
  }

  if (!config.isConfigured) {
    const prepared = generateWhatsAppInvoiceLink({
      recipientPhone,
      studentName,
      invoiceNumber,
      billingPeriod,
      totalAmount,
      amountPaid,
      balanceRemaining,
      pdfPublicUrl
    });

    return {
      ...prepared,
      simulated: false,
      manualSendRequired: true,
      pdfPath: pdfPath || null,
      error: prepared.success ? null : prepared.error
    };
  }

  if (pdfPublicUrl) {
    const caption = `Dear ${studentName}, please find your invoice ${invoiceNumber} for ${billingPeriod}. Amount Paid: ₹${Number(amountPaid ?? totalAmount ?? 0).toFixed(2)}${Number(balanceRemaining || 0) > 0 ? `. Balance Due: ₹${Number(balanceRemaining).toFixed(2)}` : ' (Fully Paid)'}. — Sridevi Nrithyalaya`;

    const payload = {
      messaging_product: 'whatsapp',
      to: formattedPhone,
      type: 'document',
      document: {
        link: pdfPublicUrl,
        caption,
        filename: `Invoice_${String(invoiceNumber).replace(/[\/\\]/g, '_')}.pdf`
      }
    };

    return sendMetaWhatsAppRequest(config, payload, 20000);
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: formattedPhone,
    type: 'template',
    template: {
      name: config.invoiceTemplateName,
      language: { code: config.templateLang },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: studentName },
            { type: 'text', text: invoiceNumber },
            { type: 'text', text: billingPeriod },
            { type: 'text', text: `₹${Number(amountPaid ?? totalAmount ?? 0).toFixed(2)}` },
            {
              type: 'text',
              text: Number(balanceRemaining || 0) > 0
                ? `₹${Number(balanceRemaining).toFixed(2)}`
                : 'NIL (Fully Paid)'
            }
          ]
        }
      ]
    }
  };

  return sendMetaWhatsAppRequest(config, payload, 20000);
}

/**
 * Shared Meta API request helper.
 */
function sendMetaWhatsAppRequest(config, payload, timeoutMs) {
  const postData = JSON.stringify(payload);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const options = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/${config.apiVersion}/${config.phoneId}/messages`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';

      res.on('data', chunk => body += chunk);

      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);

          if (
            res.statusCode >= 200 &&
            res.statusCode < 300 &&
            parsed.messages &&
            parsed.messages[0]
          ) {
            finish({
              success: true,
              status: 'SENT',
              messageId: parsed.messages[0].id
            });
          } else {
            finish({
              success: false,
              status: 'FAILED',
              error: parsed.error?.message || `HTTP ${res.statusCode}: ${body}`
            });
          }
        } catch {
          finish({
            success: false,
            status: 'FAILED',
            error: `Failed to parse WhatsApp API response: ${body}`
          });
        }
      });
    });

    req.on('error', err => {
      finish({
        success: false,
        status: 'FAILED',
        error: `WhatsApp network error: ${err.message}`
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish({
        success: false,
        status: 'FAILED',
        error: `WhatsApp API request timeout (${timeoutMs / 1000}s)`
      });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Escape HTML text to prevent markup injection in emails.
 */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

/**
 * Generate branded SDN HTML email template.
 */
function generateReminderEmailHtml({
  studentName,
  parentName,
  billingPeriod,
  amount,
  upiLink,
  upiId
}) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiLink)}`;
  const displayRecipient = parentName
    ? `${escapeHtml(parentName)} (Parent of ${escapeHtml(studentName)})`
    : escapeHtml(studentName);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fee Reminder — Sridevi Nrithyalaya</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; background-color: #fdfbf7; color: #1a1a1a; }
    .email-container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; border: 1px solid #e8dfd2; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { background: linear-gradient(135deg, #d10807 0%, #850000 100%); color: #ffffff; padding: 30px 24px; text-align: center; }
    .header h1 { font-family: Georgia, serif; font-size: 24px; margin: 0 0 6px 0; letter-spacing: 0.5px; }
    .header p { margin: 0; font-size: 13px; color: #ffd680; text-transform: uppercase; letter-spacing: 1px; }
    .content { padding: 30px 24px; }
    .due-box { background: #fdf9f0; border: 1.5px solid #c59b27; border-radius: 6px; padding: 18px 20px; margin: 20px 0; text-align: center; }
    .due-amount { font-size: 28px; font-weight: 800; color: #850000; margin: 8px 0; }
    .pay-button { display: inline-block; background: #d10807; color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 700; font-size: 16px; margin: 15px 0 10px 0; letter-spacing: 0.5px; }
    .qr-container { text-align: center; margin: 20px 0; padding: 16px; background: #fafafa; border-radius: 6px; border: 1px dashed #d9d9d9; }
    .disclaimer { font-size: 12px; color: #777777; line-height: 1.5; margin-top: 24px; padding-top: 16px; border-top: 1px solid #eeeeee; }
    .footer { background: #f5ede0; padding: 18px 24px; text-align: center; font-size: 12px; color: #666666; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <h1>Sridevi Nrithyalaya</h1>
      <p>Bharatanatyam Academy &amp; Repertory &bull; Chennai</p>
    </div>
    <div class="content">
      <p style="font-size: 16px; margin-top: 0;">Dear <strong>${displayRecipient}</strong>,</p>
      <p style="line-height: 1.6; color: #333333;">
        This is a cordial monthly fee reminder regarding the classical dance curriculum tuition dues for <strong>${escapeHtml(billingPeriod)}</strong>.
      </p>
      <div class="due-box">
        <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #850000; font-weight: 700;">Outstanding Balance</div>
        <div class="due-amount">₹${Number(amount).toFixed(2)}</div>
        <div style="font-size: 13px; color: #666666;">Student: <strong>${escapeHtml(studentName)}</strong> &bull; Cycle: <strong>${escapeHtml(billingPeriod)}</strong></div>
      </div>
      <div style="text-align: center;">
        <a href="${escapeHtml(upiLink)}" class="pay-button">👉 Click Here to Pay via UPI App</a>
        <div style="font-size: 12px; color: #666666; margin-top: 4px;">(Opens GPay, PhonePe, Paytm, or BHIM on mobile devices)</div>
      </div>
      <div class="qr-container">
        <div style="font-size: 13px; font-weight: 700; color: #333333; margin-bottom: 8px;">Scan Academy UPI QR Code to Pay:</div>
        <img src="${qrUrl}" alt="UPI Payment QR Code" width="160" height="160" style="display: block; margin: 0 auto; border: 1px solid #ddd; border-radius: 4px;">
        <div style="font-size: 12px; color: #555555; margin-top: 8px;">Official VPA: <strong>${escapeHtml(upiId)}</strong></div>
      </div>
      <div class="disclaimer">
        <p><strong>Note:</strong> If you have already completed this payment via bank transfer, please disregard this notification or share your UTR / transaction reference with the academy administration for payment verification.</p>
        <p style="margin-bottom: 0;">For any billing queries, please contact us at <strong>contact@sridevinrithyalaya.org</strong> or <strong>${escapeHtml(process.env.INSTITUTION_PHONE || '+91 98405 35825')}</strong>.</p>
      </div>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Sridevi Nrithyalaya. ${escapeHtml(process.env.INSTITUTION_ADDRESS || 'New No. 19, Old No. 15, AVM Colony 1st Street, Kamarajar Salai, Virugambakkam, Chennai, Tamil Nadu 600092')}.
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Send automated Email reminder via Nodemailer (SMTP).
 */
async function sendEmailReminder({
  recipientEmail,
  studentName,
  parentName,
  billingPeriod,
  amount,
  upiLink
}) {
  const config = getEmailConfig();
  const upiId = process.env.INSTITUTION_UPI_VPA || 'sridevinrithyalaya@indianbank';

  if (!isValidEmail(recipientEmail)) {
    return {
      success: false,
      status: 'FAILED',
      error: 'Invalid recipient email address format'
    };
  }

  if (!config.isConfigured) {
    return {
      success: false,
      status: 'SIMULATED',
      simulated: true,
      error: 'SMTP credentials not configured in environment (SMTP_HOST / SMTP_USERNAME / SMTP_PASSWORD)'
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: process.env.SMTP_USERNAME,
      pass: process.env.SMTP_PASSWORD
    }
  });

  const plainText = [
    `Dear ${parentName ? `${parentName} (Parent of ${studentName})` : studentName},`,
    '',
    `This is a cordial fee reminder from Sridevi Nrithyalaya for ${billingPeriod}.`,
    `Outstanding Amount: INR ${Number(amount).toFixed(2)}`,
    '',
    `Pay via UPI Deep Link: ${upiLink}`,
    `Academy UPI VPA: ${upiId}`,
    '',
    'If you have already paid, please disregard this notification.',
    '',
    'Warm regards,',
    'Sridevi Nrithyalaya'
  ].join('\n');

  const htmlContent = generateReminderEmailHtml({
    studentName,
    parentName,
    billingPeriod,
    amount,
    upiLink,
    upiId
  });

  try {
    const info = await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: recipientEmail,
      subject: `Monthly Fee Reminder (${billingPeriod}) — Sridevi Nrithyalaya`,
      text: plainText,
      html: htmlContent
    });

    return {
      success: true,
      status: 'SENT',
      messageId: info.messageId
    };
  } catch (err) {
    return {
      success: false,
      status: 'FAILED',
      error: `SMTP error: ${err.message}`
    };
  }
}

module.exports = {
  generateUpiLink,
  formatWhatsAppPhone,
  generateWhatsAppLink,
  generateWhatsAppReminderLink,
  generateWhatsAppInvoiceLink,
  isValidEmail,
  getWhatsAppConfig,
  getEmailConfig,
  sendWhatsAppReminder,
  sendWhatsAppInvoice,
  sendEmailReminder
};
