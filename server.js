const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const { supabaseInsert, supabaseUpdate } = require('./supabase');

const app = express();
const PORT = process.env.PORT || 3000;

// Store email status for real-time polling
const emailStatusMap = {};

// ── Middleware ──────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// ── Nodemailer Transport ───────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USERNAME,
    pass: process.env.SMTP_PASSWORD
  },
  connectionTimeout: 10000,
  greetingTimeout: 5000,
  socketTimeout: 10000
});


// ── Helpers ────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDatePHP(dateStr, format) {
  if (!dateStr) return '';
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  if (format === 'd M. Y') return `${day} ${month}. ${year}`;
  return `${day}-${month}-${year}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d;
}

function now() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function numberToWords(num) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  if (num == 0) return 'Zero';
  let paisa = '';
  if (String(num).includes('.')) {
    let parts = String(num).split('.');
    num = parseInt(parts[0]);
    let paisaVal = parseInt((parts[1] + '00').substring(0, 2));
    if (paisaVal > 0) {
      paisa = ' and ' + convertToWords(paisaVal, ones, tens) + ' Paise';
    }
  } else {
    num = parseInt(num);
  }
  return convertToWords(num, ones, tens) + paisa;
}

function convertToWords(num, ones, tens) {
  if (num == 0) return '';
  let words = '';
  if (Math.floor(num / 10000000) > 0) {
    words += convertToWords(Math.floor(num / 10000000), ones, tens) + ' Crore ';
    num %= 10000000;
  }
  if (Math.floor(num / 100000) > 0) {
    words += convertToWords(Math.floor(num / 100000), ones, tens) + ' Lakh ';
    num %= 100000;
  }
  if (Math.floor(num / 1000) > 0) {
    words += convertToWords(Math.floor(num / 1000), ones, tens) + ' Thousand ';
    num %= 1000;
  }
  if (Math.floor(num / 100) > 0) {
    words += convertToWords(Math.floor(num / 100), ones, tens) + ' Hundred ';
    num %= 100;
  }
  if (num > 0) {
    if (words !== '') words += 'and ';
    if (num < 20) {
      words += ones[num];
    } else {
      words += tens[Math.floor(num / 10)];
      if (num % 10 > 0) words += ' ' + ones[num % 10];
    }
  }
  return words.trim();
}


// ══════════════════════════════════════════════════════════
//  SHARED: Invoice HTML Builder (Browser View)
// ══════════════════════════════════════════════════════════
function buildInvoiceHTML(c) {
  const invoiceNo = 'S-' + String(c.id || c.ref_id.slice(-4)).padStart(4, '0');
  const totalAmount = parseFloat(c.amount);
  const taxableAmount = Math.round((totalAmount / 1.18) * 100) / 100;
  const cgstAmount = Math.round((taxableAmount * 0.09) * 100) / 100;
  const sgstAmount = Math.round((taxableAmount * 0.09) * 100) / 100;
  const amountInWords = 'INR ' + numberToWords(totalAmount.toFixed(2)) + ' Only';
  const invoiceDate = formatDatePHP(c.paid_at || new Date().toISOString(), 'd-M-Y');

  let batchDate;
  if (c.batch_date) {
    batchDate = formatDatePHP(c.batch_date, 'd M. Y');
  } else {
    const futureDate = addDays(c.paid_at || new Date().toISOString(), 2);
    batchDate = formatDatePHP(futureDate.toISOString(), 'd M. Y');
  }

  return `<div class="invoice" id="invoice-content">
<table>
<tr>
<td style="width: 50%;">
<img src="images/tb.png" class="logo">
<br><b>TECHNICAL TRADE<br>CONSULTANCY</b><br><br>
1372, Shukrawar Peth, Natubag,<br>Near Kelkar Museum<br>Pune 411002.<br>
Contact No.: 9272000111<br>Email: info@tusharbhumkar.com<br>Website: tusharbhumkar.com<br>
GSTIN/UIN: 27AIWPB6660M1ZK<br>State Name: Maharashtra<br>Code: 27
</td>
<td style="width:50%;padding:0;">
<table>
<tr>
<td class="bold">Invoice No.<br>${invoiceNo}</td>
<td class="bold">Dated<br>${invoiceDate}</td>
</tr>
<tr>
<td colspan="2">
<b>Buyer:</b><br>${escapeHtml(c.full_name)}<br>Pune<br>
Contact No.: ${escapeHtml(c.mobile)}<br>Email ID: ${escapeHtml(c.email)}<br>
Batch Dt: ${batchDate}<br>GSTIN/UIN:<br>State Name: Maharashtra
</td>
</tr>
</table>
</td>
</tr>
</table>
<table>
<tr>
    <th style="width:5%;">Sr</th>
    <th style="width:15%;">HSN/SAC</th>
    <th>Particulars</th>
    <th style="width:18%;">Amount</th>
</tr>
<tr style="height:170px;">
    <td>1<br><br>2<br>3</td>
    <td>999293</td>
    <td>
        <b>Training Charges</b>
        <div style="margin-top:25px;text-align:left;">
            <b>OUTPUT CGST @ 9%</b><br>
            <b>OUTPUT SGST @ 9%</b>
        </div>
    </td>
    <td class="right">
        <b>${taxableAmount.toFixed(2)}</b><br><br><br>
        <b>${cgstAmount.toFixed(2)}</b><br>
        <b>${sgstAmount.toFixed(2)}</b>
    </td>
</tr>
<tr>
    <td colspan="3" class="right bold">Total</td>
    <td class="right bold" style="font-size:13px;">RS.${totalAmount.toFixed(2)}</td>
</tr>
</table>
<table>
<tr>
<td>Amount Chargeable (in words)<br><br><b>${amountInWords}</b></td>
<td class="right">E. & O.E.</td>
</tr>
</table>
<table>
    <tr>
        <td class="terms-block">
            <span class="section-title">Terms and Conditions</span><br>
            <em>Please read the terms & conditions to avoid any conflict of interest.</em>
            <ol>
                <li>We are not SEBI-registered research analysts or investment advisors.</li>
                <li>We are only providing education services for the stock & commodity market.</li>
                <li>All discussion and analysis in online and offline classes is just for education. We do not provide any tips, calls, buy-sell recommendations, assurance of return, guarantees on my learning techniques, investment advice, portfolio management, or account handling services.</li>
                <li>After course completion, always conduct your own research and practice to choose securities for investment & trading. Our learning & teaching techniques do not guarantee any favourable returns, as market conditions may vary.</li>
                <li>Investments in the securities market are subject to market risk. Read all the related documents carefully before investing.</li>
                <li>Booking amount or fees paid towards any of our teaching and learning services are non-refundable under any conditions, and booking amount will not be transferred and refunded in any circumstances. A seat once booked can be postponed only one time in case of unavoidable circumstances.</li>
                <li>For any queries related to our course or if you have any questions or need more information, please contact us directly.</li>
            </ol>
        </td>
    </tr>
</table>
</div>`;
}


// ══════════════════════════════════════════════════════════
//  EMAIL: Build Inline-Style HTML Invoice (for email clients)
// ══════════════════════════════════════════════════════════
function buildEmailInvoiceHTML(c) {
  const invoiceNo = 'S-' + String(c.id || c.ref_id.slice(-4)).padStart(4, '0');
  const totalAmount = parseFloat(c.amount);
  const taxableAmount = Math.round((totalAmount / 1.18) * 100) / 100;
  const cgstAmount = Math.round((taxableAmount * 0.09) * 100) / 100;
  const sgstAmount = Math.round((taxableAmount * 0.09) * 100) / 100;
  const amountInWords = 'INR ' + numberToWords(totalAmount.toFixed(2)) + ' Only';
  const invoiceDate = formatDatePHP(c.paid_at || new Date().toISOString(), 'd-M-Y');

  let batchDate;
  if (c.batch_date) {
    batchDate = formatDatePHP(c.batch_date, 'd M. Y');
  } else {
    const futureDate = addDays(c.paid_at || new Date().toISOString(), 2);
    batchDate = formatDatePHP(futureDate.toISOString(), 'd M. Y');
  }

  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

  return `
<div style="font-family: 'Times New Roman', Times, serif; max-width: 650px; margin: 0 auto; background: #fff; border: 1px solid #000;">
  
  <!-- Header Table -->
  <table width="100%" cellpadding="4" cellspacing="0" border="1" style="border-collapse: collapse; font-size: 12px;">
    <tr>
      <td width="50%" valign="top" style="padding: 10px;">
        <b style="font-size: 14px;">TECHNICAL TRADE<br>CONSULTANCY</b><br><br>
        1372, Shukrawar Peth, Natubag,<br>
        Near Kelkar Museum<br>
        Pune 411002.<br>
        Contact No.: 9272000111<br>
        Email: info@tusharbhumkar.com<br>
        Website: tusharbhumkar.com<br>
        GSTIN/UIN: 27AIWPB6660M1ZK<br>
        State Name: Maharashtra<br>
        Code: 27
      </td>
      <td width="50%" valign="top" style="padding: 10px;">
        <table width="100%" cellpadding="2" cellspacing="0" border="0">
          <tr>
            <td style="font-weight: bold;">Invoice No.</td>
            <td style="font-weight: bold;">Dated</td>
          </tr>
          <tr>
            <td>${invoiceNo}</td>
            <td>${invoiceDate}</td>
          </tr>
        </table>
        <br>
        <b>Buyer:</b><br>
        ${escapeHtml(c.full_name)}<br>
        Pune<br>
        Contact No.: ${escapeHtml(c.mobile)}<br>
        Email ID: ${escapeHtml(c.email)}<br>
        Batch Dt: ${batchDate}<br>
        GSTIN/UIN: <br>
        State Name: Maharashtra
      </td>
    </tr>
  </table>

  <!-- Items Table -->
  <table width="100%" cellpadding="4" cellspacing="0" border="1" style="border-collapse: collapse; font-size: 12px;">
    <tr style="background: #f0f0f0;">
      <th width="5%" style="text-align: center;">Sr</th>
      <th width="15%" style="text-align: center;">HSN/SAC</th>
      <th style="text-align: center;">Particulars</th>
      <th width="18%" style="text-align: center;">Amount</th>
    </tr>
    <tr>
      <td style="text-align: center;">1<br><br><br>2<br>3</td>
      <td style="text-align: center;">999293</td>
      <td>
        <b>Training Charges</b>
        <br><br><br>
        <b>OUTPUT CGST @ 9%</b><br>
        <b>OUTPUT SGST @ 9%</b>
      </td>
      <td style="text-align: right;">
        <b>${taxableAmount.toFixed(2)}</b>
        <br><br><br>
        <b>${cgstAmount.toFixed(2)}</b><br>
        <b>${sgstAmount.toFixed(2)}</b>
      </td>
    </tr>
    <tr>
      <td colspan="3" style="text-align: right; font-weight: bold;">Total</td>
      <td style="text-align: right; font-weight: bold; font-size: 13px;">RS.${totalAmount.toFixed(2)}</td>
    </tr>
  </table>

  <!-- Amount in Words -->
  <table width="100%" cellpadding="8" cellspacing="0" border="1" style="border-collapse: collapse; font-size: 12px;">
    <tr>
      <td>Amount Chargeable (in words)<br><br><b>${amountInWords}</b></td>
      <td style="text-align: right;">E. & O.E.</td>
    </tr>
  </table>

  <!-- Terms -->
  <table width="100%" cellpadding="4" cellspacing="0" border="1" style="border-collapse: collapse; font-size: 11px;">
    <tr>
      <td style="padding: 10px; line-height: 1.6;">
        <b style="text-transform: uppercase;">Terms and Conditions</b><br>
        <em>Please read the terms & conditions to avoid any conflict of interest.</em>
        <ol style="margin: 8px 0 0 18px; padding: 0;">
          <li style="margin-bottom: 4px; text-align: justify;">We are not SEBI-registered research analysts or investment advisors.</li>
          <li style="margin-bottom: 4px; text-align: justify;">We are only providing education services for the stock & commodity market.</li>
          <li style="margin-bottom: 4px; text-align: justify;">All discussion and analysis in online and offline classes is just for education. We do not provide any tips, calls, buy-sell recommendations, assurance of return, guarantees on my learning techniques, investment advice, portfolio management, or account handling services.</li>
          <li style="margin-bottom: 4px; text-align: justify;">After course completion, always conduct your own research and practice to choose securities for investment & trading.</li>
          <li style="margin-bottom: 4px; text-align: justify;">Investments in the securities market are subject to market risk.</li>
          <li style="margin-bottom: 4px; text-align: justify;">Booking amount or fees paid are non-refundable under any conditions.</li>
          <li style="margin-bottom: 4px; text-align: justify;">For any queries, please contact us directly.</li>
        </ol>
      </td>
    </tr>
  </table>
</div>

<div style="text-align: center; font-size: 11px; padding: 15px 0; color: #666; font-family: Arial, sans-serif;">
  *** This is a Computer Generated Tax Invoice and does not require a physical signature. ***
  <br><br>
  <a href="${baseUrl}/invoice?ref_id=${c.ref_id}" style="display: inline-block; padding: 10px 25px; background: #22c55e; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">
    📄 Download PDF Invoice
  </a>
</div>
  `;
}


// ══════════════════════════════════════════════════════════
//  ROUTE: Registration Form
// ══════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});


// ══════════════════════════════════════════════════════════
//  ROUTE: Pay
// ══════════════════════════════════════════════════════════
app.post('/pay', async (req, res) => {
  const { name, mobile, email, course_name, batch_date, amount } = req.body;
  const refId = "TTC" + Math.floor(Date.now() / 1000);

  try {
    await supabaseInsert('customers', {
      ref_id: refId, full_name: name, mobile: mobile,
      email: email, course_name: course_name, batch_date: batch_date, amount: amount
    });
  } catch (err) {
    console.error(err.message);
    return res.send(`<script>alert('${err.message}');window.history.back();</script>`);
  }

  res.send(`
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <script>
      var options = {
        key: "${process.env.RAZORPAY_KEY_ID}",
        amount: ${amount * 100},
        currency: "INR",
        name: "Trade Tech Course",
        description: "Course Payment",
        notes: { ref_id: "${refId}" },
        handler: function(response) {
          window.location = "/success?payment_id=" + response.razorpay_payment_id + "&ref_id=${refId}";
        },
        modal: {
          ondismiss: function() {
            window.location = "/failed?ref_id=${refId}&reason=cancelled";
          }
        }
      };
      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function(response) {
        window.location = "/failed?ref_id=${refId}&reason=failed";
      });
      rzp.open();
    </script>
  `);
});


// ══════════════════════════════════════════════════════════
//  ROUTE: Failed
// ══════════════════════════════════════════════════════════
app.get('/failed', async (req, res) => {
  const { ref_id, reason } = req.query;
  if (ref_id) {
    try { await supabaseUpdate('customers', { payment_status: reason || 'unknown' }, 'ref_id', ref_id); }
    catch (err) { console.error(err.message); }
  }
  const reasonText = {
    cancelled: 'You closed the payment window.',
    failed: 'The payment could not be completed.',
    unknown: 'An unexpected error occurred.'
  };
  res.send(`
    <!DOCTYPE html><html><head><title>Payment Failed</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Segoe UI', sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
      .card { background: white; border-radius: 16px; padding: 40px; max-width: 500px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center; }
      .icon { width: 80px; height: 80px; background: #ef4444; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 36px; color: white; }
      h1 { color: #1a1a1a; font-size: 24px; margin-bottom: 8px; }
      .sub { color: #888; margin-bottom: 28px; }
      .reason-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 14px 16px; margin-bottom: 28px; font-size: 14px; color: #991b1b; }
      .btn { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; }
      .btn:hover { background: #5a6fd6; }
    </style></head><body>
    <div class="card">
      <div class="icon">✕</div>
      <h1>Payment ${reason === 'cancelled' ? 'Cancelled' : 'Failed'}</h1>
      <p class="sub">${reasonText[reason] || reasonText.unknown}</p>
      <div class="reason-box">Reference ID: <strong>${ref_id}</strong></div>
      <a href="/" class="btn">← Try Again</a>
    </div></body></html>
  `);
});


// ══════════════════════════════════════════════════════════
//  ROUTE: Email Status Polling
// ══════════════════════════════════════════════════════════
app.get('/email-status/:ref_id', (req, res) => {
  res.json({ status: emailStatusMap[req.params.ref_id] || '⏳ Sending...' });
});


// ══════════════════════════════════════════════════════════
//  ROUTE: Success
// ══════════════════════════════════════════════════════════
app.get('/success', async (req, res) => {
  const payment_id = req.query.payment_id || 'N/A';
  const ref_id = req.query.ref_id || 'N/A';

  let isVerified = false;
  let razorpayDebug = "No API call made";

  if (payment_id === 'MANUAL_QR') {
    isVerified = true;
    razorpayDebug = "Manual QR Payment";
  } else if (payment_id !== 'N/A') {
    try {
      const auth = Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64');
      const payRes = await fetch('https://api.razorpay.com/v1/payments/' + payment_id, {
        headers: { 'Authorization': 'Basic ' + auth }
      });
      const paymentData = await payRes.json();
      razorpayDebug = `HTTP ${payRes.status} | Status: ${paymentData.status || 'NONE'}`;
      if (payRes.ok && paymentData.status) {
        isVerified = ['captured', 'authorized'].includes(paymentData.status);
      }
    } catch (err) {
      razorpayDebug = "❌ Fetch Error: " + err.message;
    }
  }

  let customer = null;
  if (ref_id !== 'N/A') {
    try {
      const fetchRes = await fetch(process.env.SUPABASE_URL + '/rest/v1/customers?ref_id=eq.' + encodeURIComponent(ref_id) + '&select=*', {
        headers: { 'apikey': process.env.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + process.env.SUPABASE_ANON_KEY }
      });
      const result = await fetchRes.json();
      if (Array.isArray(result) && result.length > 0) customer = result[0];
    } catch (err) { console.error('Fetch customer error:', err); }
  }

  if (ref_id !== 'N/A') {
    try {
      await supabaseUpdate('customers', {
        payment_id: payment_id,
        payment_status: isVerified ? "paid" : "unverified",
        paid_at: now()
      }, 'ref_id', ref_id);
    } catch (err) { console.error('Update error:', err.message); }
  }

  // FIRE & FORGET — Page loads instantly, email sends in background
  if (customer && isVerified) {
    emailStatusMap[ref_id] = "⏳ Sending...";
    
    sendInvoiceEmail(customer, ref_id)
      .then(status => console.log(`📧 ${ref_id}: ${status}`))
      .catch(err => console.error(`📧 ${ref_id} FAILED:`, err.message));
    
    sendWhatsAppInvoice(customer, payment_id)
      .catch(err => console.error(`💬 ${ref_id} WhatsApp FAILED:`, err.message));
  }

  res.send(`
<!DOCTYPE html>
<html><head><title>Payment Successful</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .card { background: white; border-radius: 16px; padding: 40px; max-width: 500px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center; }
  .icon { width: 80px; height: 80px; background: #22c55e; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
  .icon svg { width: 40px; height: 40px; fill: white; }
  h1 { color: #1a1a1a; font-size: 24px; margin-bottom: 8px; }
  .details { background: #f8f9fa; border-radius: 10px; padding: 20px; margin-bottom: 20px; text-align: left; }
  .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
  .detail-row:last-child { border-bottom: none; }
  .detail-label { color: #888; font-size: 14px; }
  .detail-value { color: #333; font-weight: 600; font-size: 14px; word-break: break-all; }
  .verified { color: #22c55e; }
  .unverified { color: #f59e0b; }
  .btn { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 10px; }
  .btn:hover { background: #5a6fd6; }
  .debug-box { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 10px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; font-family: monospace; text-align: left; word-break: break-all; }
</style></head><body>
  <div class="card">
    <div class="icon"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>
    <h1>Payment Successful! 🎉</h1>
    <div class="debug-box">
      📧 Email: <b id="email-status">⏳ Sending...</b><br>
      🔍 Payment: <b>${razorpayDebug}</b>
    </div>
    <div class="details">
      <div class="detail-row"><span class="detail-label">Payment ID</span><span class="detail-value">${payment_id}</span></div>
      <div class="detail-row"><span class="detail-label">Reference ID</span><span class="detail-value">${ref_id}</span></div>
      <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${customer ? customer.full_name : 'N/A'}</span></div>
      <div class="detail-row"><span class="detail-label">Course</span><span class="detail-value">${customer ? customer.course_name : 'N/A'}</span></div>
      <div class="detail-row"><span class="detail-label">Batch</span><span class="detail-value">${customer ? formatDatePHP(customer.batch_date, 'd M. Y') : 'N/A'}</span></div>
      <div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value">₹${customer ? Number(customer.amount).toLocaleString('en-IN') : 'N/A'}</span></div>
      <div class="detail-row"><span class="detail-label">Verification</span><span class="detail-value ${isVerified ? 'verified' : 'unverified'}">${isVerified ? '✅ Verified' : '⚠️ Unverified'}</span></div>
    </div>
    <a href="/invoice?ref_id=${ref_id}" class="btn" style="background:#22c55e; margin-right:10px;">📄 View Invoice</a>
    <a href="/" class="btn">← Back to Home</a>
  </div>

  <script>
    const refId = '${ref_id}';
    const statusEl = document.getElementById('email-status');
    let attempts = 0;
    const check = setInterval(() => {
      if (++attempts > 20) return clearInterval(check);
      fetch('/email-status/' + refId)
        .then(r => r.json())
        .then(d => { 
          statusEl.textContent = d.status; 
          if (!d.status.includes('⏳')) clearInterval(check); 
        })
        .catch(() => {});
    }, 1000);
  </script>
</body></html>
  `);
});


// ══════════════════════════════════════════════════════════
//  ROUTE: Invoice (Browser View + Client-Side PDF Download)
// ══════════════════════════════════════════════════════════
app.get('/invoice', async (req, res) => {
  const ref_id = req.query.ref_id;
  if (!ref_id) return res.status(400).send('No reference ID provided');

  let c = null;
  try {
    const url = process.env.SUPABASE_URL + '/rest/v1/customers?ref_id=eq.' + encodeURIComponent(ref_id) + '&select=*';
    const fetchRes = await fetch(url, {
      headers: { 'apikey': process.env.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + process.env.SUPABASE_ANON_KEY }
    });
    if (!fetchRes.ok) return res.status(500).send('Error fetching customer data');
    const result = await fetchRes.json();
    if (!Array.isArray(result) || result.length === 0) return res.status(404).send('Customer not found');
    c = result[0];
  } catch (err) {
    return res.status(500).send('Connection Error');
  }

  const invoiceNo = 'S-' + String(c.id || c.ref_id.slice(-4)).padStart(4, '0');

  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Tax Invoice - ${invoiceNo}</title>
<!-- html2canvas + jsPDF for client-side PDF generation -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:"Times New Roman", serif;background:#eee;padding:20px;}
.invoice{width:800px;margin: 40px auto 20px auto;background:#fff;border:1px solid #000;padding:0;}
.invoice .logo{width:75px;}
table{width:100%;border-collapse:collapse;}
td,th{border:1px solid #000;padding:4px;vertical-align:top;font-size:12px;}
.center{text-align:center;}
.right{text-align:right;}
.bold{font-weight:bold;}
.print-btn{padding:10px 20px;background:#000;color:#fff;border:none;cursor:pointer;margin-bottom:15px;font-size:14px;}
.pdf-btn{padding:10px 20px;background:#22c55e;color:#fff;border:none;cursor:pointer;margin-bottom:15px;font-size:14px;margin-left:10px;}
.btn-container{text-align:center;margin-bottom:10px;}
.terms-block{padding:10px;font-size:12px;line-height:1.5;}
.terms-block .section-title{font-weight:bold;font-size:12px;text-transform:uppercase;}
.terms-block em{display:block;margin:4px 0 8px 0;}
.terms-block ol{margin-left:18px;padding-left:0;}
.terms-block li{margin-bottom:4px;text-align:justify;}
.footer-note{text-align:center;font-size:11px;padding:10px;font-weight:bold;}
.loading-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;justify-content:center;align-items:center;}
.loading-overlay.active{display:flex;}
.loading-box{background:#fff;padding:30px 40px;border-radius:12px;text-align:center;}
.spinner{width:40px;height:40px;border:4px solid #eee;border-top:4px solid #22c55e;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 15px;}
@keyframes spin{to{transform:rotate(360deg);}}
@media print{
  .btn-container,.loading-overlay{display:none!important;}
  body{background:#fff;padding:0;}
  .invoice{margin-top:40px;margin-bottom:0;}
}
</style>
</head>
<body>

<div class="loading-overlay" id="loading">
  <div class="loading-box">
    <div class="spinner"></div>
    <p><strong>Generating PDF...</strong></p>
    <p style="color:#888;font-size:13px;">Please wait</p>
  </div>
</div>

<div class="btn-container">
  <button onclick="window.print()" class="print-btn">🖨️ Print</button>
  <button onclick="downloadPDF()" class="pdf-btn" id="pdfBtn">📥 Download PDF</button>
</div>

<div id="invoice-wrapper">
 ${buildInvoiceHTML(c)}
</div>

<div class="footer-note">
  *** This is a Computer Generated Tax Invoice and does not require a physical signature. ***
</div>

<script>
async function downloadPDF() {
  const btn = document.getElementById('pdfBtn');
  const loading = document.getElementById('loading');
  
  btn.disabled = true;
  btn.textContent = '⏳ Generating...';
  loading.classList.add('active');
  
  try {
    const element = document.getElementById('invoice-wrapper');
    
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false
    });
    
    const { jsPDF } = window.jspdf;
    const imgData = canvas.toDataURL('image/png');
    
    // A5 dimensions in mm
    const pdfWidth = 148;
    const pdfHeight = 210;
    
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    
    // Calculate scaling to fit A5 width
    const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
    const imgX = (pdfWidth - (imgWidth * ratio)) / 2;
    
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a5'
    });
    
    // If content is taller than one page, add pages
    const scaledHeight = imgHeight * ratio;
    let position = 0;
    let pageHeight = pdfHeight;
    
    if (scaledHeight <= pageHeight) {
      // Single page
      pdf.addImage(imgData, 'PNG', imgX, 5, imgWidth * ratio, scaledHeight);
    } else {
      // Multi-page
      let remainingHeight = scaledHeight;
      let sourceY = 0;
      
      while (remainingHeight > 0) {
        if (position > 0) pdf.addPage();
        
        const drawHeight = Math.min(remainingHeight, pageHeight - 10);
        const sourceHeight = drawHeight / ratio;
        
        // Create a temporary canvas for this page
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sourceHeight;
        const ctx = pageCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, canvas.width, sourceHeight);
        
        const pageImgData = pageCanvas.toDataURL('image/png');
        pdf.addImage(pageImgData, 'PNG', imgX, 5, imgWidth * ratio, drawHeight);
        
        sourceY += sourceHeight;
        remainingHeight -= drawHeight;
        position += pageHeight;
      }
    }
    
    pdf.save('Invoice_${invoiceNo.replace(/\s/g, '')}.pdf');
    
  } catch (err) {
    console.error('PDF generation failed:', err);
    alert('PDF generation failed. Please use Print > Save as PDF instead.');
  } finally {
    btn.disabled = false;
    btn.textContent = '📥 Download PDF';
    loading.classList.remove('active');
  }
}
</script>
</body></html>
  `);
});


// ══════════════════════════════════════════════════════════
//  FUNCTION: Send Invoice Email (HTML-based, NO PDF API)
// ══════════════════════════════════════════════════════════
async function sendInvoiceEmail(customer, ref_id) {
  console.log(`📧 Starting email for ${ref_id}...`);
  
  const name = customer.full_name;
  const email = customer.email;
  const invoiceNo = 'S - ' + String(ref_id).slice(-5).padStart(2, '0');

  try {
    const info = await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
      to: `${name} <${email}>`,
      subject: `Tax Invoice ${invoiceNo} | Technical Trade Consultancy`,
      html: buildEmailInvoiceHTML(customer),
      text: `Dear ${name},\n\nThank you for your payment.\n\nInvoice No: ${invoiceNo}\nAmount: ₹${customer.amount}\n\nPlease view your detailed invoice at:\n${process.env.BASE_URL || 'http://localhost:' + PORT}/invoice?ref_id=${ref_id}\n\nRegards,\nTechnical Trade Consultancy`
    });
    
    console.log(`✅ Email sent: ${info.messageId}`);
    emailStatusMap[ref_id] = "✅ Sent!";
    return "✅ Sent!";
  } catch (err) {
    console.error('❌ Email Send Error:', err.message);
    emailStatusMap[ref_id] = "❌ " + err.message;
    return "❌ " + err.message;
  }
}


// ══════════════════════════════════════════════════════════
//  FUNCTION: Send WhatsApp Invoice
// ══════════════════════════════════════════════════════════
async function sendWhatsAppInvoice(customer, payment_id) {
  let mobile = String(customer.mobile).replace(/[^0-9]/g, '');
  if (mobile.length === 10) mobile = '91' + mobile;
  const batch = formatDatePHP(customer.batch_date, 'd M. Y');
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

  try {
    await fetch('https://api.interakt.ai/v1/public/message/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + process.env.INTERAKT_API_KEY },
      body: JSON.stringify({
        campaignId: "", phoneNumber: mobile, callbackData: customer.ref_id,
        parameters: [
          { name: "name", value: customer.full_name },
          { name: "course", value: customer.course_name },
          { name: "amount", value: "₹" + customer.amount },
          { name: "payment_id", value: payment_id },
          { name: "ref_id", value: customer.ref_id },
          { name: "batch", value: batch },
          { name: "invoice_link", value: `${baseUrl}/invoice?ref_id=${customer.ref_id}` }
        ]
      })
    });
    console.log(`💬 WhatsApp sent to ${mobile}`);
  } catch (err) { console.error('💬 WhatsApp error:', err.message); }
}


// ── Start Server ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
