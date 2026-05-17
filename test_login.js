const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    console.log("Testing exact server.js query...");
    const { data, error } = await supabase.from('users').select('id, email, role, name, password_hash, telegram_chat_id, telegram_active, detection_timer').eq('email', 'teste@email.com').single();
    if (error) {
        console.error("Supabase Error:", error);
    } else {
        console.log("User fetched:", JSON.stringify(data, null, 2));
    }
}
test();
