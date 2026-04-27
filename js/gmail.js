/**
 * Gmail API Integration Module
 */

const CLIENT_ID = 'VITE_GMAIL_CLIENT_ID';
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

let tokenClient;
let accessToken = null;

/**
 * Initialize Google Identity Services
 */
export function initGoogleAuth() {
    if (typeof google === 'undefined') {
        console.warn('Google scripts not loaded yet. Retrying in 1s...');
        setTimeout(initGoogleAuth, 1000);
        return;
    }

    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (tokenResponse) => {
                if (tokenResponse.error !== undefined) {
                    throw (tokenResponse);
                }
                accessToken = tokenResponse.access_token;

                // Salva o token e a expiração (expires_in é em segundos)
                const expiryTime = Date.now() + (tokenResponse.expires_in * 1000);
                localStorage.setItem('gmail_access_token', accessToken);
                localStorage.setItem('gmail_token_expiry', expiryTime);

                console.log('Access token acquired and persisted');
                document.dispatchEvent(new CustomEvent('gmail-connected'));
            },
        });

        // Tenta carregar token persistido
        const savedToken = localStorage.getItem('gmail_access_token');
        const savedExpiry = localStorage.getItem('gmail_token_expiry');

        if (savedToken && savedExpiry && Date.now() < parseInt(savedExpiry)) {
            accessToken = savedToken;
            console.log('Valid persisted token found');
            // Aguarda um pequeno delay para garantir que o app.js carregou seus listeners
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('gmail-connected'));
            }, 100);
        }

        console.log('Google Auth Initialized successfully');
    } catch (err) {
        console.error('Erro ao iniciar Google Auth:', err);
    }
}

/**
 * Handle Gmail Connection (Trigger Popup)
 */
export async function connectGmail() {
    if (accessToken === null) {
        // Prompt the user to select a Google Account and ask for consent to share their data
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        // Skip display of account chooser and consent dialog for an existing session
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

/**
 * Search for transaction-related emails and fetch details
 */
export async function fetchTransactionEmails(config = {}) {
    if (!accessToken) return [];

    try {
        const { sender = 'from:nubank.com.br', period = '30d' } = config;
        // Filtramos por remetente e garantimos e-mails do período selecionado
        let query = `${sender} newer_than:${period}`;

        const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (response.status === 401) {
            console.warn('Gmail access token expired or invalid');
            accessToken = null;
            localStorage.removeItem('gmail_access_token');
            localStorage.removeItem('gmail_token_expiry');
            document.dispatchEvent(new CustomEvent('gmail-disconnected'));
            return [];
        }

        const data = await response.json();
        if (!data.messages) return [];

        const results = [];
        for (const msg of data.messages) {
            const detailResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (detailResponse.status === 401) {
                accessToken = null;
                localStorage.removeItem('gmail_access_token');
                document.dispatchEvent(new CustomEvent('gmail-disconnected'));
                return [];
            }

            const details = await detailResponse.json();

            const headers = details.payload.headers;
            const subject = headers.find(h => h.name === 'Subject')?.value || 'Sem Assunto';
            const fromHeader = headers.find(h => h.name === 'From')?.value || '';
            const date = headers.find(h => h.name === 'Date')?.value || '';

            // Limpa o nome do remetente (Ex: "Nubank <no-reply@...>" -> "Nubank")
            const senderName = fromHeader.replace(/<.*>/, '').replace(/"/g, '').trim();

            // Extrai o corpo do e-mail (decodifica Base64)
            let bodyText = details.snippet;
            if (details.payload.parts) {
                // Tenta achar texto puro, se não achar tenta HTML
                const part = details.payload.parts.find(p => p.mimeType === 'text/plain') ||
                    details.payload.parts.find(p => p.mimeType === 'text/html') ||
                    details.payload.parts[0];

                if (part.body.data) {
                    bodyText = b64DecodeUnicode(part.body.data);
                } else if (part.parts) {
                    // Trata e-mails aninhados
                    const nestedPart = part.parts.find(p => p.mimeType === 'text/plain') || part.parts[0];
                    if (nestedPart.body.data) bodyText = b64DecodeUnicode(nestedPart.body.data);
                }
            } else if (details.payload.body.data) {
                bodyText = b64DecodeUnicode(details.payload.body.data);
            }

            // Remove tags HTML se o corpo for HTML para não confundir o regex
            const cleanBody = bodyText.replace(/<[^>]*>/g, ' ');

            // Regex para capturar valor (R$ 1.234,56 ou apenas 1.234,56)
            const amountRegex = /(?:R\$|valor de|total de|transferência de|recebeu um Pix de|pagou|valor:)\s?(\d+(?:\.\d{3})*(?:,\d{2}))/i;

            let match = cleanBody.match(amountRegex) || subject.match(amountRegex);

            if (!match) {
                match = cleanBody.match(/R\$\s?(\d+(?:\.\d{3})*(?:,\d{2}))/i);
            }

            const amountStr = match ? match[1] : '0,00';
            const amount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.'));

            // Tenta extrair o nome da pessoa ou estabelecimento (Payee/Payer)
            // Usamos padrões mais específicos para evitar capturar textos do rodapé (como "para você se conectar")
            const entityPatterns = [
                // 1. Padrões de Recebimento (Payer)
                /(?:recebeu uma transferência pelo Pix de|recebeu um Pix de|recebeu uma transferência de|enviado por)\s+(.+?)(?=\s+no valor|\s+foi realizada|\s+já está|\s+-|\n|$)/i,
                /(?:Nome|Pagador|Origem)\s*:\s*([^.\n]+)/i,

                // 2. Padrões de Envio (Payee)
                /(?:transferiu para|enviou para|enviado para|A transferência para)\s+(.+?)(?=\s+foi realizada|\s+-|\n|$)/i,
                /(?:Destinatário|Para)\s*:\s*([^.\n]+)/i,

                // 3. Padrão Genérico (Fallback)
                /Pix de\s+(.+?)(?=\s+no valor|\s+foi realizada|\.|\n|$)/i
            ];

            let entityName = '';
            for (const pattern of entityPatterns) {
                const eMatch = cleanBody.match(pattern);
                if (eMatch && eMatch[1]) {
                    let extracted = eMatch[1].trim();

                    // Remove ruídos comuns em e-mails de transação (ex: Nubank)
                    extracted = extracted.replace(/\s*foi realizada com sucesso.*$/i, '');
                    extracted = extracted.replace(/\s*já está disponível.*$/i, '');
                    extracted = extracted.replace(/\s*no valor de.*$/i, '');
                    extracted = extracted.replace(/\s*pelo Pix.*$/i, '');
                    extracted = extracted.replace(/\s*O valor.*$/i, '');
                    extracted = extracted.replace(/\s*CPF.*$/i, '');
                    extracted = extracted.replace(/\s*CNPJ.*$/i, '');
                    extracted = extracted.replace(/\s*Instituição.*$/i, '');
                    extracted = extracted.replace(/\s*Agência.*$/i, '');
                    extracted = extracted.replace(/\s*Conta.*$/i, '');
                    extracted = extracted.replace(/\s*Data.*$/i, '');

                    // Se o resultado ficou muito curto ou parece ser parte de uma frase (contém "você", "seu", etc), ignoramos
                    if (extracted.length < 2 || /\b(você|seu|sua|com|para)\b/i.test(extracted)) {
                        continue;
                    }

                    entityName = extracted.trim();

                    // Limpa nomes muito longos ou com sujeira de HTML
                    if (entityName.length > 50) entityName = entityName.substring(0, 50).trim();
                    break;
                }
            }

            results.push({
                id: msg.id,
                date: new Date(date).toISOString().split('T')[0],
                subject: subject.replace('Fwd: ', '').replace('Re: ', ''),
                senderName: senderName,
                entityName: entityName,
                amount: amount,
                snippet: details.snippet,
                body: bodyText.substring(0, 500)
            });
        }
        return results;
    } catch (error) { console.error(error); return []; }
}

/**
 * Helper to decode Google's Base64 variant
 */
function b64DecodeUnicode(str) {
    // Replace non-url compatible chars
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    return decodeURIComponent(atob(str).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
}
