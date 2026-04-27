const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

async function testRegister() {
    console.log("Tentando registrar usuário de teste...");
    const name = "Teste";
    const email = "teste_" + Date.now() + "@exemplo.com";
    const password = "password123";
    const password_hash = await bcrypt.hash(password, 12);

    const { data, error } = await supabase
        .from('users')
        .insert({ name, email, password_hash, role: 'user' })
        .select();

    if (error) {
        console.error("❌ ERRO NO INSERT:");
        console.error(JSON.stringify(error, null, 2));
    } else {
        console.log("✅ Usuário registrado com sucesso!");
        console.log(data);
    }
}

testRegister();
