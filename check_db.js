const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkAlertsTable() {
    console.log('--- VERIFICANDO ESTRUTURA ALERTS ---');
    
    const { data, error } = await supabase.from('alerts').select('*').limit(1);
    
    if (error) {
        console.log('ERRO AO LER ALERTS:', error.message);
    } else {
        console.log('TABELA ALERTS OK!');
        console.log('Colunas detectadas:', Object.keys(data[0] || {}));
    }
}

checkAlertsTable();
