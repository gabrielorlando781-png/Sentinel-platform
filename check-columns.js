const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

async function checkColumns() {
    // Tenta pegar um registro e ver as chaves
    const { data, error } = await supabase.from('users').select('*').limit(1);
    if (error) {
        console.error("Erro:", error.message);
        return;
    }
    
    if (data && data.length > 0) {
        console.log("Colunas encontradas:", Object.keys(data[0]));
    } else {
        console.log("A tabela está vazia. Vou tentar listar as colunas via rpc ou erro de insert proposital.");
        // Fazendo um insert vazio para forçar um erro que pode listar colunas ou apenas testar a presença
        const { error: iError } = await supabase.from('users').insert({ dummy_column: 'test' });
        console.log("Erro ao inserir coluna inexistente (detalhes):", iError.message);
    }
}

checkColumns();
