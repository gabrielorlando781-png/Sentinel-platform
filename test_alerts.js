const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function test() {
    console.log("Testing alerts query for teste@email.com");
    // get user id
    const {data: u} = await supabase.from('users').select('id').eq('email', 'teste@email.com').single();
    if(!u) return console.log("User not found");
    
    // mimic /api/alerts
    const { data, error, count } = await supabase
        .from('alerts')
        .select('*', { count: 'exact' })
        .eq('user_id', u.id)
        .order('created_at', { ascending: false })
        .range(0, 49);
        
    if(error) console.error("Error:", error);
    else console.log("Alerts:", data.length);
}
test();
