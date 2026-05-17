const fetch = require('node-fetch');
require('dotenv').config();

async function testAlert() {
    console.log('--- TESTE DE DISPARO DE ALERTA ---');
    
    // 1. Simular login para pegar token
    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'test@test.com', // User deve existir
            password: 'password123'
        })
    });
    
    const loginData = await loginRes.json();
    if (!loginRes.ok) {
        console.log('ERRO NO LOGIN:', loginData.error);
        return;
    }
    const token = loginData.token;
    console.log('Login OK! Token obtido.');

    // 2. Disparar alerta
    const alertRes = await fetch('http://localhost:3000/api/alert', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
            type: 'TESTE_IA_QUEDA',
            severity: 'critical',
            confidence: 99,
            description: 'Teste de sincronização forçado',
            screenshot: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAAAAAAAAAAAAAAAAAAAAAP/aAArelative_path/abroad'
        })
    });

    const alertData = await alertRes.json();
    if (alertRes.ok) {
        console.log('SUCESSO! Alerta criado no banco:', alertData.id);
        console.log('URL da Foto:', alertData.screenshot_url);
    } else {
        console.log('ERRO AO CRIAR ALERTA:', alertData.error);
    }
}

testAlert();
