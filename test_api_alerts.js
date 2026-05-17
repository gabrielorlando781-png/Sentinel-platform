const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch'); // node 18+ has global fetch, we are on node 22, so we can just use global fetch.
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const jwt = require('jsonwebtoken');

function signToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

async function test() {
    console.log("Generating token for teste@email.com");
    const {data: u} = await supabase.from('users').select('*').eq('email', 'teste@email.com').single();
    if(!u) return console.log("User not found");
    
    const token = signToken({ id: u.id, email: u.email, role: u.role, name: u.name });
    
    console.log("Fetching /api/alerts as user");
    const res = await fetch('http://localhost:3000/api/alerts?limit=50&offset=0', {
        headers: { 'Authorization': 'Bearer ' + token }
    });
    
    const json = await res.json();
    console.log("Status:", res.status);
    console.log("Body:", json);
}
test();
