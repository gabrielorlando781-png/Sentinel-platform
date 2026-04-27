const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

async function debug() {
    console.log("--- DEBUG CONEXÃO SUPABASE ---");
    console.log("URL:", process.env.SUPABASE_URL);
    
    // Teste 1: Listar tabelas (via rpc ou select simples)
    console.log("\n1. Testando acesso à tabela 'users'...");
    const { data, error } = await supabase.from('users').select('*').limit(1);
    
    if (error) {
        console.error("❌ ERRO AO ACESSAR TABELA 'users':", error.message);
        console.error("Dica: Verifique se você executou o SQL no painel do Supabase.");
    } else {
        console.log("✅ Conexão com 'users' OK.");
    }

    // Teste 2: Verificar Storage
    console.log("\n2. Testando acesso ao Bucket 'screenshots'...");
    const { data: buckets, error: bError } = await supabase.storage.listBuckets();
    if (bError) {
        console.error("❌ ERRO AO LISTAR BUCKETS:", bError.message);
    } else {
        const hasScreenshots = buckets.find(b => b.name === 'screenshots');
        if (hasScreenshots) {
            console.log("✅ Bucket 'screenshots' encontrado.");
        } else {
            console.error("❌ Bucket 'screenshots' NÃO encontrado. Crie-o no painel Storage do Supabase.");
        }
    }
}

debug();
