const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function diagnose() {
    console.log('--- DIAGNÓSTICO SENTINEL ---');
    console.log('URL:', process.env.SUPABASE_URL);
    
    // 1. Testar conexão
    const { data: tables, error: tableError } = await supabase.from('users').select('*').limit(1);
    
    if (tableError) {
        console.log('ERRO NA TABELA USERS:', tableError.message);
        if (tableError.message.includes('does not exist')) {
            console.log('>>> A TABELA "users" NÃO EXISTE NO BANCO!');
        }
    } else {
        console.log('TABELA "users" ENCONTRADA!');
        console.log('Colunas detectadas:', Object.keys(tables[0] || {}));
    }

    // 2. Testar inserção fake (para ver erro de schema)
    const { error: insertError } = await supabase.from('users').insert({
        email: 'test_diag@sentinel.com',
        password_hash: 'test',
        name: 'Diag Test'
    });

    if (insertError) {
        console.log('ERRO AO INSERIR:', insertError.message);
        console.log('DETALHES:', insertError.details);
    } else {
        console.log('INSERÇÃO DE TESTE FUNCIONOU!');
        // Limpar
        await supabase.from('users').delete().eq('email', 'test_diag@sentinel.com');
    }
}

diagnose();
