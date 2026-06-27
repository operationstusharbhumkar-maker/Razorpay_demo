const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer'); // Kept as local fallback only
const { supabaseInsert, supabaseUpdate } = require('./supabase');

const app = express();
const PORT = process.env.PORT || 3000;

// Store email status for real-time polling
const emailStatusMap = {};

// ── Middleware ──────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// ── Nodemailer Transport (Local Fallback Only) ─────────────
const smtpPort = Number(process.env.SMTP_PORT) || 465;
const isSecurePort = smtpPort === 465;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: isSecurePort,
  auth: {
    user: process.env.SMTP_USERNAME,
    pass: process.env.SMTP_PASSWORD
  },
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
  tls: { rejectUnauthorized: false }
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
    if (paisaVal > 0) paisa = ' and ' + convertToWords(paisaVal, ones, tens) + ' Paise';
  } else {
    num = parseInt(num);
  }
  return convertToWords(num, ones, tens) + paisa;
}

function convertToWords(num, ones, tens) {
  if (num == 0) return '';
  let words = '';
  if (Math.floor(num / 10000000) > 0) { words += convertToWords(Math.floor(num / 10000000), ones, tens) + ' Crore '; num %= 10000000; }
  if (Math.floor(num / 100000) > 0) { words += convertToWords(Math.floor(num / 100000), ones, tens) + ' Lakh '; num %= 100000; }
  if (Math.floor(num / 1000) > 0) { words += convertToWords(Math.floor(num / 1000), ones, tens) + ' Thousand '; num %= 1000; }
  if (Math.floor(num / 100) > 0) { words += convertToWords(Math.floor(num / 100), ones, tens) + ' Hundred '; num %= 100; }
  if (num > 0) {
    if (words !== '') words += 'and ';
    if (num < 20) words += ones[num];
    else { words += tens[Math.floor(num / 10)]; if (num % 10 > 0) words += ' ' + ones[num % 10]; }
  }
  return words.trim();
}


// ══════════════════════════════════════════════════════════
//  HTML BUILDER: Browser Invoice View
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
  if (c.batch_date) batchDate = formatDatePHP(c.batch_date, 'd M. Y');
  else { const f = addDays(c.paid_at || new Date().toISOString(), 2); batchDate = formatDatePHP(f.toISOString(), 'd M. Y'); }

  return `<div class="invoice" id="invoice-content">
<table>
<tr>
<td style="width:50%;"><img src="images/tb.png" class="logo"><br><b>TECHNICAL TRADE<br>CONSULTANCY</b><br><br>
1372, Shukrawar Peth, Natubag,<br>Near Kelkar Museum<br>Pune 411002.<br>
Contact No.: 9272000111<br>Email: info@tusharbhumkar.com<br>Website: tusharbhumkar.com<br>
GSTIN/UIN: 27AIWPB6660M1ZK<br>State Name: Maharashtra<br>Code: 27</td>
<td style="width:50%;padding:0;"><table>
<tr><td class="bold">Invoice No.<br>${invoiceNo}</td><td class="bold">Dated<br>${invoiceDate}</td></tr>
<tr><td colspan="2"><b>Buyer:</b><br>${escapeHtml(c.full_name)}<br>Pune<br>
Contact No.: ${escapeHtml(c.mobile)}<br>Email ID: ${escapeHtml(c.email)}<br>
Batch Dt: ${batchDate}<br>GSTIN/UIN:<br>State Name: Maharashtra</td></tr>
</table></td></tr></table>
<table>
<tr><th style="width:5%;">Sr</th><th style="width:15%;">HSN/SAC</th><th>Particulars</th><th style="width:18%;">Amount</th></tr>
<tr style="height:170px;"><td>1<br><br>2<br>3</td><td>999293</td><td>
<b>Training Charges</b><div style="margin-top:25px;text-align:left;"><b>OUTPUT CGST @ 9%</b><br><b>OUTPUT SGST @ 9%</b></div></td>
<td class="right"><b>${taxableAmount.toFixed(2)}</b><br><br><br><b>${cgstAmount.toFixed(2)}</b><br><b>${sgstAmount.toFixed(2)}</b></td></tr>
<tr><td colspan="3" class="right bold">Total</td><td class="right bold" style="font-size:13px;">RS.${totalAmount.toFixed(2)}</td></tr>
</table>
<table><tr><td>Amount Chargeable (in words)<br><br><b>${amountInWords}</b></td><td class="right">E. & O.E.</td></tr></table>
<table><tr><td class="terms-block">
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
</ol></td></tr></table></div>`;
}


// ══════════════════════════════════════════════════════════
//  HTML BUILDER: Email Invoice (Inline CSS for Gmail/Outlook)
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
  if (c.batch_date) batchDate = formatDatePHP(c.batch_date, 'd M. Y');
  else { const f = addDays(c.paid_at || new Date().toISOString(), 2); batchDate = formatDatePHP(f.toISOString(), 'd M. Y'); }
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;

  return `
<div style="font-family:'Times New Roman',Times,serif;max-width:650px;margin:0 auto;background:#fff;border:1px solid #000;">
<table width="100%" cellpadding="4" cellspacing="0" border="1" style="border-collapse:collapse;font-size:12px;">
<tr><td width="50%" valign="top" style="padding:10px;">
<b style="font-size:14px;">TECHNICAL TRADE<br>CONSULTANCY</b><br><br>
1372, Shukrawar Peth, Natubag,<br>Near Kelkar Museum<br>Pune 411002.<br>
Contact No.: 9272000111<br>Email: info@tusharbhumkar.com<br>Website: tusharbhumkar.com<br>
GSTIN/UIN: 27AIWPB6660M1ZK<br>State Name: Maharashtra<br>Code: 27</td>
<td width="50%" valign="top" style="padding:10px;">
<table width="100%" cellpadding="2" cellspacing="0" border="0">
<tr><td style="font-weight:bold;">Invoice No.</td><td style="font-weight:bold;">Dated</td></tr>
<tr><td>${invoiceNo}</td><td>${invoiceDate}</td></tr></table><br>
<b>Buyer:</b><br>${escapeHtml(c.full_name)}<br>Pune<br>
Contact No.: ${escapeHtml(c.mobile)}<br>Email ID: ${escapeHtml(c.email)}<br>
Batch Dt: ${batchDate}<br>GSTIN/UIN:<br>State Name: Maharashtra</td></tr></table>
<table width="100%" cellpadding="4" cellspacing="0" border="1" style="border-collapse:collapse;font-size:12px;">
<tr style="background:#f0f0f0;"><th width="5%" style="text-align:center;">Sr</th><th width="15%" style="text-align:center;">HSN/SAC</th><th style="text-align:center;">Particulars</th><th width="18%" style="text-align:center;">Amount</th></tr>
<tr><td style="text-align:center;">1<br><br><br>2<br>3</td><td style="text-align:center;">999293</td><td>
<b>Training Charges</b><br><br><br><b>OUTPUT CGST @ 9%</b><br><b>OUTPUT SGST @ 9%</b></td>
<td style="text-align:right;"><b>${taxableAmount.toFixed(2)}</b><br><br><br><b>${cgstAmount.toFixed(2)}</b><br><b>${sgstAmount.toFixed(2)}</b></td></tr>
<tr><td colspan="3" style="text-align:right;font-weight:bold;">Total</td><td style="text-align:right;font-weight:bold;font-size:13px;">RS.${totalAmount.toFixed(2)}</td></tr></table>
<table width="100%" cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;font-size:12px;">
<tr><td>Amount Chargeable (in words)<br><br><b>${amountInWords}</b></td><td style="text-align:right;">E. & O.E.</td></tr></table>
<table width="100%" cellpadding="4" cellspacing="0" border="1" style="border-collapse:collapse;font-size:11px;">
<tr><td style="padding:10px;line-height:1.6;">
<b style="text-transform:uppercase;">Terms and Conditions</b><br>
<em>Please read the terms & conditions to avoid any conflict of interest.</em>
<ol style="margin:8px 0 0 18px;padding:0;">
<li style="margin-bottom:4px;text-align:justify;">We are not SEBI-registered research analysts or investment advisors.</li>
<li style="margin-bottom:4px;text-align:justify;">We are only providing education services for the stock & commodity market.</li>
<li style="margin-bottom:4px;text-align:justify;">All discussion and analysis in online and offline classes is just for education. We do not provide any tips, calls, buy-sell recommendations, assurance of return, guarantees on my learning techniques, investment advice, portfolio management, or account handling services.</li>
<li style="margin-bottom:4px;text-align:justify;">After course completion, always conduct your own research and practice to choose securities for investment & trading.</li>
<li style="margin-bottom:4px;text-align:justify;">Investments in the securities market are subject to market risk.</li>
<li style="margin-bottom:4px;text-align:justify;">Booking amount or fees paid are non-refundable under any conditions.</li>
<li style="margin-bottom:4px;text-align:justify;">For any queries, please contact us directly.</li>
</ol></td></tr></table></div>
<div style="text-align:center;font-size:11px;padding:15px 0;color:#666;font-family:Arial,sans-serif;">
*** Computer Generated Tax Invoice ***<br><br>
<a href="${baseUrl}/invoice?ref_id=${c.ref_id}" style="display:inline-block;padding:12px 30px;background:#22c55e;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px;">
📄 Download PDF Invoice</a></div>`;
}


// ══════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════

// Registration Form
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Pay
app.post('/pay', async (req, res) => {
  const { name, mobile, email, course_name, batch_date, amount } = req.body;
  const refId = "TTC" + Math.floor(Date.now() / 1000);
  try {
    await supabaseInsert('customers', { ref_id: refId, full_name: name, mobile: mobile, email: email, course_name: course_name, batch_date: batch_date, amount: amount });
  } catch (err) {
    console.error(err.message);
    return res.send(`<script>alert('${err.message}');window.history.back();</script>`);
  }
  res.send(`<script src="https://checkout.razorpay.com/v1/checkout.js"></script><script>
    var options={key:"${process.env.RAZORPAY_KEY_ID}",amount:${amount*100},currency:"INR",name:"Trade Tech Course",description:"Course Payment",notes:{ref_id:"${refId}"},
    handler:function(r){window.location="/success?payment_id="+r.razorpay_payment_id+"&ref_id=${refId}";},
    modal:{ondismiss:function(){window.location="/failed?ref_id=${refId}&reason=cancelled";}}};
    var rzp=new Razorpay(options);
    rzp.on('payment.failed',function(){window.location="/failed?ref_id=${refId}&reason=failed";});
    rzp.open();</script>`);
});

// Failed
app.get('/failed', async (req, res) => {
  const { ref_id, reason } = req.query;
  if (ref_id) { try { await supabaseUpdate('customers', { payment_status: reason || 'unknown' }, 'ref_id', ref_id); } catch (e) {} }
  const t = { cancelled: 'You closed the payment window.', failed: 'The payment could not be completed.', unknown: 'An unexpected error occurred.' };
  res.send(`<!DOCTYPE html><html><head><title>Payment Failed</title><style>
    *{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Segoe UI',sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}
    .card{background:#fff;border-radius:16px;padding:40px;max-width:500px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);text-align:center;}
    .icon{width:80px;height:80px;background:#ef4444;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:36px;color:#fff;}
    h1{font-size:24px;margin-bottom:8px;}.sub{color:#888;margin-bottom:28px;}
    .box{background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin-bottom:28px;font-size:14px;color:#991b1b;}
    .btn{display:inline-block;padding:12px 30px;background:#667eea;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;}</style></head><body>
    <div class="card"><div class="icon">✕</div><h1>Payment ${reason==='cancelled'?'Cancelled':'Failed'}</h1>
    <p class="sub">${t[reason]||t.unknown}</p><div class="box">Reference: <strong>${ref_id}</strong></div>
    <a href="/" class="btn">← Try Again</a></div></body></html>`);
});

// Email Status Polling
app.get('/email-status/:ref_id', (req, res) => {
  res.json({ status: emailStatusMap[req.params.ref_id] || '⏳ Sending...' });
});

// Success
app.get('/success', async (req, res) => {
  const payment_id = req.query.payment_id || 'N/A';
  const ref_id = req.query.ref_id || 'N/A';
  let isVerified = false, razorpayDebug = "No API call made";

  if (payment_id === 'MANUAL_QR') { isVerified = true; razorpayDebug = "Manual QR Payment"; }
  else if (payment_id !== 'N/A') {
    try {
      const auth = Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64');
      const r = await fetch('https://api.razorpay.com/v1/payments/' + payment_id, { headers: { 'Authorization': 'Basic ' + auth } });
      const d = await r.json();
      razorpayDebug = `HTTP ${r.status} | Status: ${d.status || 'NONE'}`;
      if (r.ok && d.status) isVerified = ['captured', 'authorized'].includes(d.status);
    } catch (e) { razorpayDebug = "❌ " + e.message; }
  }

  let customer = null;
  if (ref_id !== 'N/A') {
    try {
      const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/customers?ref_id=eq.' + encodeURIComponent(ref_id) + '&select=*', { headers: { 'apikey': process.env.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + process.env.SUPABASE_ANON_KEY } });
      const result = await r.json();
      if (Array.isArray(result) && result.length > 0) customer = result[0];
    } catch (e) {}
  }

  if (ref_id !== 'N/A') { try { await supabaseUpdate('customers', { payment_id, payment_status: isVerified ? "paid" : "unverified", paid_at: now() }, 'ref_id', ref_id); } catch (e) {} }

  // Fire & Forget Email and WhatsApp
  if (customer && isVerified) {
    emailStatusMap[ref_id] = "⏳ Sending...";
    sendInvoiceEmail(customer, ref_id).then(s => console.log(`📧 ${ref_id}: ${s}`)).catch(e => console.error(`📧 ${ref_id} FAILED:`, e.message));
    sendWhatsAppInvoice(customer, payment_id).catch(e => console.error(`💬 WA FAILED:`, e.message));
  }

  res.send(`<!DOCTYPE html><html><head><title>Payment Successful</title><style>
    *{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Segoe UI',Arial,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}
    .card{background:#fff;border-radius:16px;padding:40px;max-width:500px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);text-align:center;}
    .icon{width:80px;height:80px;background:#22c55e;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;}
    .icon svg{width:40px;height:40px;fill:#fff;}h1{font-size:24px;margin-bottom:8px;}
    .details{background:#f8f9fa;border-radius:10px;padding:20px;margin-bottom:20px;text-align:left;}
    .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;}.row:last-child{border:none;}
    .lbl{color:#888;font-size:14px;}.val{color:#333;font-weight:600;font-size:14px;word-break:break-all;}
    .ok{color:#22c55e;}.warn{color:#f59e0b;}
    .btn{display:inline-block;padding:12px 30px;background:#667eea;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin-top:10px;}
    .dbg{background:#d4edda;border:1px solid #c3e6cb;color:#155724;padding:10px;border-radius:8px;margin-bottom:20px;font-size:13px;font-family:monospace;text-align:left;word-break:break-all;}</style></head><body>
    <div class="card"><div class="icon"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>
    <h1>Payment Successful! 🎉</h1>
    <div class="dbg">📧 Email: <b id="es">⏳ Sending...</b><br>🔍 Payment: <b>${razorpayDebug}</b></div>
    <div class="details">
      <div class="row"><span class="lbl">Payment ID</span><span class="val">${payment_id}</span></div>
      <div class="row"><span class="lbl">Reference ID</span><span class="val">${ref_id}</span></div>
      <div class="row"><span class="lbl">Name</span><span class="val">${customer?customer.full_name:'N/A'}</span></div>
      <div class="row"><span class="lbl">Course</span><span class="val">${customer?customer.course_name:'N/A'}</span></div>
      <div class="row"><span class="lbl">Batch</span><span class="val">${customer?formatDatePHP(customer.batch_date,'d M. Y'):'N/A'}</span></div>
      <div class="row"><span class="lbl">Amount</span><span class="val">₹${customer?Number(customer.amount).toLocaleString('en-IN'):'N/A'}</span></div>
      <div class="row"><span class="lbl">Verification</span><span class="val ${isVerified?'ok':'warn'}">${isVerified?'✅ Verified':'⚠️ Unverified'}</span></div>
    </div>
    <a href="/invoice?ref_id=${ref_id}" class="btn" style="background:#22c55e;margin-right:10px;">📄 View Invoice</a>
    <a href="/" class="btn">← Home</a></div>
    <script>const r='${ref_id}',s=document.getElementById('es');let a=0;const c=setInterval(()=>{if(++a>20)return clearInterval(c);fetch('/email-status/'+r).then(r=>r.json()).then(d=>{s.textContent=d.status;if(!d.status.includes('⏳'))clearInterval(c);}).catch(()=>{});},1000);</script>
    </body></html>`);
});

// Invoice (Browser View + Client-Side PDF)
app.get('/invoice', async (req, res) => {
  const ref_id = req.query.ref_id;
  if (!ref_id) return res.status(400).send('No reference ID');
  let c = null;
  try {
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/customers?ref_id=eq.' + encodeURIComponent(ref_id) + '&select=*', { headers: { 'apikey': process.env.SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + process.env.SUPABASE_ANON_KEY } });
    if (!r.ok) return res.status(500).send('DB Error');
    const result = await r.json();
    if (!Array.isArray(result) || !result.length) return res.status(404).send('Not found');
    c = result[0];
  } catch (e) { return res.status(500).send('Connection Error'); }
  const ino = 'S-' + String(c.id || c.ref_id.slice(-4)).padStart(4, '0');
  
  res.send(`<!DOCTYPE html><html><head><title>Invoice ${ino}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:"Times New Roman",serif;background:#eee;padding:20px;}
.invoice{width:800px;margin:40px auto 20px;background:#fff;border:1px solid #000;}.invoice .logo{width:75px;}
table{width:100%;border-collapse:collapse;}td,th{border:1px solid #000;padding:4px;vertical-align:top;font-size:12px;}
.right{text-align:right;}.bold{font-weight:bold;}.btns{text-align:center;margin-bottom:10px;}
button{padding:10px 20px;border:none;cursor:pointer;font-size:14px;border-radius:4px;margin:0 5px;}
.print{background:#000;color:#fff;}.pdf{background:#22c55e;color:#fff;}
.terms-block{padding:10px;font-size:12px;line-height:1.5;}.terms-block .section-title{font-weight:bold;text-transform:uppercase;}
.terms-block em{display:block;margin:4px 0 8px;}.terms-block ol{margin-left:18px;}.terms-block li{margin-bottom:4px;text-align:justify;}
.foot{text-align:center;font-size:11px;padding:10px;font-weight:bold;}
.loading{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);z-index:9999;justify-content:center;align-items:center;}
.loading.on{display:flex;}.lbox{background:#fff;padding:30px 40px;border-radius:12px;text-align:center;}
.spin{width:40px;height:40px;border:4px solid #eee;border-top:4px solid #22c55e;border-radius:50%;animation:sp 1s linear infinite;margin:0 auto 15px;}
@keyframes sp{to{transform:rotate(360deg);}}
@media print{.btns,.loading{display:none!important;}body{background:#fff;padding:0;}.invoice{margin-top:40px;margin-bottom:0;}}</style></head><body>
<div class="loading" id="ld"><div class="lbox"><div class="spin"></div><p><strong>Generating PDF...</strong></p></div></div>
<div class="btns"><button onclick="window.print()" class="print">🖨️ Print</button><button onclick="dlPDF()" class="pdf" id="pb">📥 Download PDF</button></div>
<div id="iw">${buildInvoiceHTML(c)}</div>
<div class="foot">*** Computer Generated Tax Invoice ***</div>
<script>async function dlPDF(){const b=document.getElementById('pb'),l=document.getElementById('ld');b.disabled=true;b.textContent='⏳...';l.classList.add('on');
try{const el=document.getElementById('iw');const c=await html2canvas(el,{scale:2,useCORS:true,allowTaint:true,backgroundColor:'#fff',logging:false});
const{jsPDF}=window.jspdf;const d=c.toDataURL('image/png');const p=new jsPDF({orientation:'portrait',unit:'mm',format:'a5'});
const pw=148,ph=210;const iw=c.width,ih=c.height;const r=Math.min(pw/iw,ph/ih);const sh=ih*r;const x=(pw-iw*r)/2;
if(sh<=ph-10){p.addImage(d,'PNG',x,5,iw*r,sh);}else{let sy=0,rh=sh;while(rh>0){const dh=Math.min(rh,ph-10);const srcH=dh/r;const pc=document.createElement('canvas');pc.width=c.width;pc.height=srcH;const cx=pc.getContext('2d');cx.drawImage(c,0,sy,c.width,srcH,0,0,c.width,srcH);if(sy>0)p.addPage();p.addImage(pc.toDataURL('image/png'),'PNG',x,5,iw*r,dh);sy+=srcH;rh-=dh;}}
p.save('Invoice_${ino.replace(/\s/g,'')}.pdf');}catch(e){alert('PDF failed. Use Print > Save as PDF.');}
finally{b.disabled=false;b.textContent='📥 Download PDF';l.classList.remove('on');}}</script></body></html>`);
});


// ══════════════════════════════════════════════════════════
//  FUNCTION: Send Invoice Email
//  Primary: Resend (fetch API) | Fallback: Nodemailer SMTP
// ══════════════════════════════════════════════════════════
async function sendInvoiceEmail(customer, ref_id) {
  console.log(`📧 Starting email for ${ref_id}...`);
  
  const name = customer.full_name;
  const email = customer.email;
  const fromName = process.env.SMTP_FROM_NAME || 'Technical Trade Consultancy';
  const invoiceNo = 'S - ' + String(ref_id).slice(-5).padStart(2, '0');
  const subject = `Tax Invoice ${invoiceNo} | Technical Trade Consultancy`;
  const html = buildEmailInvoiceHTML(customer);
  const text = `Dear ${name},\n\nThank you for your payment.\nInvoice: ${invoiceNo}\nAmount: ₹${customer.amount}\n\nView: ${process.env.BASE_URL || 'http://localhost:' + PORT}/invoice?ref_id=${ref_id}\n\nRegards,\nTechnical Trade Consultancy`;

  // ── Method 1: Resend (Pure fetch - fixes Render timeout) ──
  if (process.env.RESEND_API_KEY) {
    try {
      console.log('📧 Using Resend API...');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `${fromName} <onboarding@resend.dev>`,
          to: [email],
          subject: subject,
          html: html,
          text: text
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || `HTTP ${response.status}`);
      }
      
      console.log(`✅ Resend sent: ${data.id}`);
      emailStatusMap[ref_id] = "✅ Sent!";
      return "✅ Sent!";
    } catch (err) {
      console.error('❌ Resend failed:', err.message);
      emailStatusMap[ref_id] = "❌ " + err.message;
      return "❌ " + err.message;
    }
  }

  // ── Method 2: Nodemailer SMTP (Local fallback) ──────────
  try {
    console.log('📧 Using SMTP fallback...');
    const info = await transporter.sendMail({
      from: `"${fromName}" <${process.env.SMTP_FROM_EMAIL}>`,
      to: `${name} <${email}>`,
      subject: subject,
      html: html,
      text: text
    });
    console.log(`✅ SMTP sent: ${info.messageId}`);
    emailStatusMap[ref_id] = "✅ Sent!";
    return "✅ Sent!";
  } catch (err) {
    console.error('❌ SMTP failed:', err.message);
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
  if (process.env.RESEND_API_KEY) {
    console.log('📧 Email: Resend API ✅');
  } else if (process.env.SMTP_HOST) {
    console.log(`📧 Email: SMTP (${process.env.SMTP_HOST})`);
  } else {
    console.log('⚠️  No email configured! Add RESEND_API_KEY to .env');
  }
});
