require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Prefer': 'return=minimal'
    };
}

async function supabaseInsert(table, data) {
    const url = SUPABASE_URL + '/rest/v1/' + table;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Insert Failed (HTTP ${res.status}): ${text}`);
        }
        return { success: true };
    } catch (err) {
        if (err.message.startsWith('Insert Failed') || err.message.startsWith('FetchError')) {
            throw err;
        }
        throw new Error('Connection Error: ' + err.message);
    }
}

async function supabaseUpdate(table, data, column, value) {
    const url = SUPABASE_URL + '/rest/v1/' + table + '?' + column + '=eq.' + encodeURIComponent(value);
    try {
        const res = await fetch(url, {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify(data)
        });
        if (res.status !== 204 && res.status !== 200) {
            const text = await res.text();
            throw new Error(`Update Failed (HTTP ${res.status}): ${text}`);
        }
        return { success: true };
    } catch (err) {
        if (err.message.startsWith('Update Failed') || err.message.startsWith('FetchError')) {
            throw err;
        }
        throw new Error('Connection Error: ' + err.message);
    }
}

module.exports = { supabaseInsert, supabaseUpdate };