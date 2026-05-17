require('dotenv').config();
const https = require('https');

async function testTelegram() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID || 'COLOQUE_SEU_CHAT_ID_AQUI_SE_NECESSARIO';

    console.log('--- TESTE DE INTEGRAÇÃO DO TELEGRAM ---');
    console.log(`Usando Bot Token: ${token ? 'Configurado' : 'Não configurado'}`);
    
    if (!token) {
        console.error('ERRO: TELEGRAM_BOT_TOKEN não encontrado no .env');
        return;
    }

    const message = encodeURIComponent(`🤖 *SENTINEL TESTE*\n\nSe você está lendo isso, a integração do Telegram com o seu servidor está funcionando perfeitamente!`);
    const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${message}&parse_mode=Markdown`;

    console.log(`Enviando mensagem de teste para o Chat ID: ${chatId}...`);

    https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            try {
                const response = JSON.parse(data);
                if (response.ok) {
                    console.log('✅ SUCESSO: Mensagem enviada para o Telegram!');
                } else {
                    console.log('❌ ERRO AO ENVIAR:', response.description);
                    if (response.description.includes('chat not found')) {
                        console.log('\\n-> O Bot não conseguiu encontrar este Chat ID. Certifique-se de que você mandou uma mensagem para o bot no Telegram antes!');
                    }
                }
            } catch (e) {
                console.log('Erro ao ler a resposta do Telegram:', data);
            }
        });
    }).on('error', (e) => {
        console.error('Erro na requisição:', e.message);
    });
}

testTelegram();
