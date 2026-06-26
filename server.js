const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require("fs");
const puppeteer = require("puppeteer");
const { supabaseInsert, supabaseUpdate } = require('./supabase');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Puppeteer Singleton ────────────────────────────────────
let browserInstance = null;

async function getBrowser() {
    if (browserInstance) return browserInstance;

    const chromePath =
        process.env.PUPPETEER_EXECUTABLE_PATH ||
        "/opt/render/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome";

    console.log("Chrome exists:", fs.existsSync(chromePath));
    console.log("Chrome path:", chromePath);

    browserInstance = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu"
        ]
    });

    return browserInstance;
}
// ── Nodemailer Transport ───────────────────────────────────
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'ssl',
    auth: {
        user: process.env.SMTP_USERNAME,
        pass: process.env.SMTP_PASSWORD
    }
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
    const reasonText = { cancelled: 'You closed the payment window.', failed: 'The payment could not be completed.', unknown: 'An unexpected error occurred.' };
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
//  ROUTE: Success
// ══════════════════════════════════════════════════════════
app.get('/success', async (req, res) => {
    const payment_id = req.query.payment_id || 'N/A';
    const ref_id     = req.query.ref_id || 'N/A';

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

    let emailStatus = "Skipped";
    if (customer && isVerified) {
        emailStatus = await sendInvoiceEmail(customer, ref_id);
        sendWhatsAppInvoice(customer, payment_id);
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
            📧 Email: <b>${emailStatus}</b><br>
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
</body></html>
    `);
});


// ══════════════════════════════════════════════════════════
//  ROUTE: INVOICE
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

    res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Tax Invoice - ${invoiceNo}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:"Times New Roman", serif;background:#eee;padding:20px;}
.invoice{width:800px;margin: 80px auto 20px auto;background:#fff;border:1px solid #000;}
.invoice .logo {width: 10%;}
table{width:100%;border-collapse:collapse;}
td,th{border:1px solid #000;padding:4px;vertical-align:top;font-size:12px;}
.no-border{border:none !important;}
.center{text-align:center;}
.right{text-align:right;}
.bold{font-weight:bold;}
.logo{width:75px;}
.print-btn{padding:10px 20px;background:#000;color:#fff;border:none;cursor:pointer;margin-bottom:15px;}
.terms{padding:10px;font-size:10px;line-height:1.5;}
.terms ol{margin-left:18px;}
.signature-space{height:70px;}
@media print{
    .print-btn{display:none;}
    body{background:#fff;padding:0;}
    .invoice{margin-top:80px;margin-bottom:0;}
}
.terms-block{padding:10px;font-size:12px;line-height:1.5;}
.terms-block .section-title{font-weight:bold;font-size:12px;text-transform:uppercase;}
.terms-block em{display:block;margin:4px 0 8px 0;}
.terms-block ol{margin-left:18px;padding-left:0;}
.terms-block li{margin-bottom:4px;text-align:justify;}
</style>
</head>
<body>
<button onclick="window.print()" class="print-btn">Print / Save PDF</button>
<div class="invoice">
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
</div>
<div style="text-align:center;font-size:11px;padding:10px;font-weight:bold;">
    *** This is a Computer Generated Tax Invoice and does not require a physical signature. ***
</div>
</body></html>
    `);
});


// ══════════════════════════════════════════════════════════
//  FUNCTION: Send Invoice Email with HD PDF
// ══════════════════════════════════════════════════════════
async function sendInvoiceEmail(customer, ref_id) {
    const name   = customer.full_name;
    const email  = customer.email;
    const course = customer.course_name;
    const amount = customer.amount;
    const batch  = formatDatePHP(customer.batch_date, 'd M. Y');
    const invoiceNo = 'S - ' + String(ref_id).slice(-5).padStart(2, '0');

    const topSpacePx   = 100;
    const leftSpacePx  = 30;
    const rightSpacePx = 30;

    const baseUrl = `http://localhost:${PORT}`;
    let invoiceHtml = '';
    try {
        const invoiceRes = await fetch(baseUrl + '/invoice?ref_id=' + encodeURIComponent(ref_id));
        invoiceHtml = await invoiceRes.text();
    } catch (err) { return "Failed to fetch invoice HTML"; }
    if (!invoiceHtml) return "Failed to fetch invoice HTML";

    const match = invoiceHtml.match(/<div class="invoice">([\s\S]*?)<\/div>\s*(?:<div style="|$)/);
    let cleanHtml = match ? match[1] : invoiceHtml;

    // ✅ FIX: Convert logo to Base64 so Puppeteer renders it 100% of the time
    try {
        const logoRes = await fetch(`${baseUrl}/images/tb.png`);
        if (logoRes.ok) {
            const logoBuffer = await logoRes.buffer();
            const logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
            cleanHtml = cleanHtml.replace(/src=["']images\/tb\.png["']/g, `src="${logoBase64}"`);
        }
    } catch (err) {
        console.error('Logo conversion failed:', err.message);
    }

    const pdfHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "Times New Roman", serif; background: #fff; padding: 0; margin: 0; }
    .pdf-wrapper { padding: ${topSpacePx}px ${rightSpacePx}px 0 ${leftSpacePx}px; }
    .invoice { width: 100%; margin: 0; background: #fff; border: 1px solid #000; }
    .invoice .logo { width: 10%; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border: 1px solid #000; padding: 4px; vertical-align: top; font-size: 12px; }
    .no-border { border: none !important; }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: bold; }
    .logo { width: 45px; }
    .terms { padding: 10px; font-size: 10px; line-height: 1.5; }
    .terms ol { margin-left: 18px; }
    .signature-space { height: 70px; }
    .terms-block { padding: 10px; font-size: 12px; line-height: 1.5; }
    .terms-block .section-title { font-weight: bold; font-size: 12px; text-transform: uppercase; }
    .terms-block em { display: block; margin: 4px 0 8px 0; }
    .terms-block ol { margin-left: 18px; padding-left: 0; }
    .terms-block li { margin-bottom: 4px; text-align: justify; }
    </style></head><body><div class="pdf-wrapper">${cleanHtml}</div></body></html>`;

    // 3. Generate HD PDF
    let pdfBuffer;
    try {
        const browser = await getBrowser();
        const page = await browser.newPage();
        
        await page.setViewport({ 
            width: 800, 
            height: 1200,
            deviceScaleFactor: 2 
        });
        
        await page.setContent(pdfHtml, { waitUntil: 'networkidle0' });
        
        pdfBuffer = await page.pdf({ 
            format: 'A5', 
            printBackground: true, 
            scale: 0.7 
        });
        
        await page.close();
    } catch (err) { return "PDF Error: " + err.message; }

    // 4. Send email
    try {
        await transporter.sendMail({
            from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`,
            to: `${name} <${email}>`,
            subject: `Tax Invoice ${invoiceNo} | Technical Trade Consultancy`,
            html: `
<html><body style="font-family: Arial, sans-serif; color: #333;">
    <p>Dear <strong>${name}</strong>,</p>
    <p>Thank you for enrolling in the <strong>${course}</strong> program with Technical Trade Consultancy.</p>
    <p>We are pleased to confirm receipt of your payment. Please find your tax invoice attached for your records.</p>
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse: collapse;">
        <tr><td><strong>Course</strong></td><td>${course}</td></tr>
        <tr><td><strong>Batch</strong></td><td>${batch}</td></tr>
        <tr><td><strong>Amount Paid</strong></td><td>₹${Number(amount).toLocaleString('en-IN')}</td></tr>
        <tr><td><strong>Invoice No.</strong></td><td>${invoiceNo}</td></tr>
    </table>
    <p>Please keep this invoice for your records.</p>
    <p>If you have any questions or require assistance, please contact us.</p>
    <p>Regards,<br><strong>Technical Trade Consultancy</strong><br>Phone: +91 9272000111</p>
</body></html>`,
            text: `Dear ${name},\n\nThank you for enrolling in ${course}.\n\nBatch: ${batch}\nAmount Paid: ₹${Number(amount).toLocaleString('en-IN')}\nInvoice No.: ${invoiceNo}\n\nPlease find your tax invoice attached.\n\nRegards,\nTechnical Trade Consultancy`,
            attachments: [{ filename: `Invoice_${invoiceNo}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
        });
        return "✅ Sent with HD PDF!";
    } catch (err) { return "❌ " + err.message; }
}


// ══════════════════════════════════════════════════════════
//  FUNCTION: Send WhatsApp Invoice
// ══════════════════════════════════════════════════════════
async function sendWhatsAppInvoice(customer, payment_id) {
    let mobile = String(customer.mobile).replace(/[^0-9]/g, '');
    if (mobile.length === 10) mobile = '91' + mobile;
    const batch = formatDatePHP(customer.batch_date, 'd M. Y');

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
                    { name: "batch", value: batch }
                ]
            })
        });
    } catch (err) { console.error('WhatsApp error:', err); }
}


// ── Start Server ───────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
